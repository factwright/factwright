// factwright-save: the helper Save to Factwright, the browser extension, reaches on this computer.
//
// The browser starts it for each message from the extension, through the browser's native
// messaging, and talks to it over stdin and stdout: a message is its length, in four bytes in this
// computer's byte order, then that much JSON, and so is an answer. The helper reads one message
// and answers it. A hello is answered with the app's version, without touching the disk. A job is
// checked to be a job and nothing else, then dropped, exactly as it came, into a small inbox in
// the app's data folder, for the profile open last. The app adds it from there: at once while it's
// open, or at its next start. While the app is open, the helper waits a moment for its answer, and
// passes it on.
//
// Besides the message, it reads only profiles.json, which says which profile is open, and the
// inbox: what's waiting there, and the app's own notes. It writes only the job's file, and talks
// to nothing but the browser that started it. packages/core/src/inbox.ts has the names and limits
// the extension, the helper and the app agree on, and README.md beside this file says more.
//
// One file of C11, for the Mac and Windows, and for Linux, where only the tests run it. Build it
// with `node scripts/build-helper.ts`, which compiles the app's version into it.

#if defined(__linux__)
// -std=c11 hides the system's own functions, such as openat and fsync, unless they're asked for.
#define _DEFAULT_SOURCE 1
#endif

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
// rand_s, which takes its numbers from the system's own random source, is declared on request.
#define _CRT_RAND_S
#ifndef _WIN32_WINNT
// Windows 10, the oldest Windows Factwright runs on.
#define _WIN32_WINNT 0x0A00
#endif
#endif

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#include <shlobj.h>
#else
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <pwd.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>
#if defined(__linux__)
#include <sys/random.h>
#endif
#endif

#ifndef FACTWRIGHT_VERSION
#error "Build the helper with node scripts/build-helper.ts, which gives it the app's version."
#endif

/** The longest message the helper takes: 1 MiB. A posting is long, but never that long. */
#define MESSAGE_LIMIT 1048576u

/** The longest answer from the app that the helper passes on. The app's are a line. */
#define APP_ANSWER_LIMIT 4096u

/** The most jobs that wait in an inbox at once: INBOX_LIMIT in packages/core/src/inbox.ts. */
#define INBOX_LIMIT 200

/** How long the helper waits for the open app's answer, and how often it looks, in milliseconds. */
#define ANSWER_WAIT_MS 3000u
#define LOOK_EVERY_MS 50u

/** The longest profiles.json the helper reads. The app's is a line or two. */
#define PROFILES_LIMIT 65536u

/** The longest marker of the open app the helper reads: a process ID. */
#define LISTENING_LIMIT 32u

/** The longest path the helper works with, in characters. */
#define PATH_LIMIT 4096u

/** How deep JSON may go, in objects and arrays inside each other, for the helper to read it. */
#define DEPTH_LIMIT 32

/** A job's name: 13 digits of milliseconds since 1970, a dash, then 16 random hex digits. */
#define JOB_NAME_LENGTH 30u

/** Room for the name of any file the helper writes or reads in the inbox. */
#define FILE_NAME_ROOM 40u

/** The answers the helper gives itself. The app's answer to a job goes back as the app wrote it. */
static const char ANSWER_HELLO[] = "{\"ok\":true,\"version\":\"" FACTWRIGHT_VERSION "\"}";
static const char ANSWER_LATER[] = "{\"ok\":true,\"later\":true}";
/** The job waits for an app that's open, but didn't answer in time, such as one busy starting. */
static const char ANSWER_LATER_OPEN[] = "{\"ok\":true,\"later\":true,\"open\":true}";
static const char ANSWER_BAD_MESSAGE[] = "{\"ok\":false,\"reason\":\"bad-message\"}";
static const char ANSWER_TOO_BIG[] = "{\"ok\":false,\"reason\":\"too-big\"}";
static const char ANSWER_NO_FACTWRIGHT[] = "{\"ok\":false,\"reason\":\"no-factwright\"}";
static const char ANSWER_FULL[] = "{\"ok\":false,\"reason\":\"full\"}";
static const char ANSWER_FAILED[] = "{\"ok\":false,\"reason\":\"failed\"}";

// Reading JSON. The helper reads messages strictly, so what it writes is a job and nothing else,
// and reads the app's own JSON as JSON.parse does, so it agrees with the app about what's in it.

/** A place in some bytes being read as JSON. */
typedef struct {
  const unsigned char *bytes;
  size_t length;
  size_t at;
} Reader;

/** Where a JSON string's text is, between its quotes, and whether there are escapes in it. */
typedef struct {
  size_t start;
  size_t length;
  int escaped;
} Text;

/** Skips the spaces JSON allows between its parts. */
static void skip_spaces(Reader *reader) {
  while (reader->at < reader->length) {
    unsigned char next = reader->bytes[reader->at];
    if (next != ' ' && next != '\t' && next != '\n' && next != '\r') return;
    reader->at++;
  }
}

/** Takes the byte expected next, or says it isn't there. */
static int take(Reader *reader, unsigned char expected) {
  if (reader->at >= reader->length || reader->bytes[reader->at] != expected) return 0;
  reader->at++;
  return 1;
}

static int is_digit(unsigned char byte) { return byte >= '0' && byte <= '9'; }

static int is_hex_digit(unsigned char byte) {
  return is_digit(byte) || (byte >= 'a' && byte <= 'f') || (byte >= 'A' && byte <= 'F');
}

static int is_lowercase_hex_digit(unsigned char byte) {
  return is_digit(byte) || (byte >= 'a' && byte <= 'f');
}

/**
 * Takes one UTF-8 character of two to four bytes, which starts with a byte of 0x80 or more, or
 * says it isn't well formed: no overlong forms, no surrogates, and nothing past U+10FFFF, as
 * Unicode's table of well-formed byte sequences has it.
 */
static int take_utf8(Reader *reader) {
  const unsigned char *bytes = reader->bytes + reader->at;
  size_t left = reader->length - reader->at;
  unsigned char lead = bytes[0];
  unsigned char low = 0x80;
  unsigned char high = 0xBF;
  size_t size = 0;
  if (lead >= 0xC2 && lead <= 0xDF) {
    size = 2;
  } else if (lead >= 0xE0 && lead <= 0xEF) {
    size = 3;
    // Below this, E0 would spell a character shorter. Above this, ED would spell a surrogate.
    if (lead == 0xE0) low = 0xA0;
    if (lead == 0xED) high = 0x9F;
  } else if (lead >= 0xF0 && lead <= 0xF4) {
    size = 4;
    // Below this, F0 would spell a character shorter. Above this, F4 would go past U+10FFFF.
    if (lead == 0xF0) low = 0x90;
    if (lead == 0xF4) high = 0x8F;
  } else {
    return 0;
  }
  if (left < size || bytes[1] < low || bytes[1] > high) return 0;
  for (size_t at = 2; at < size; at++) {
    if (bytes[at] < 0x80 || bytes[at] > 0xBF) return 0;
  }
  reader->at += size;
  return 1;
}

/**
 * Takes a JSON string, from its opening quote past its closing one, or says it isn't a good one:
 * no control characters as they are, only JSON's own escapes, and well-formed UTF-8. A Unicode
 * escape may name half of a surrogate pair alone, as JSON allows, and as Firefox writes a
 * character that the extension's cut at the end of a long posting split in two.
 */
static int take_string(Reader *reader, Text *text) {
  if (!take(reader, '"')) return 0;
  text->start = reader->at;
  text->escaped = 0;
  while (reader->at < reader->length) {
    unsigned char next = reader->bytes[reader->at];
    if (next == '"') {
      text->length = reader->at - text->start;
      reader->at++;
      return 1;
    }
    if (next < 0x20) return 0;
    if (next >= 0x80) {
      if (!take_utf8(reader)) return 0;
      continue;
    }
    reader->at++;
    if (next != '\\') continue;
    text->escaped = 1;
    if (reader->at >= reader->length) return 0;
    unsigned char escape = reader->bytes[reader->at];
    reader->at++;
    if (escape == 'u') {
      if (reader->length - reader->at < 4) return 0;
      for (size_t at = 0; at < 4; at++) {
        if (!is_hex_digit(reader->bytes[reader->at + at])) return 0;
      }
      reader->at += 4;
    } else if (escape != '"' && escape != '\\' && escape != '/' && escape != 'b' &&
               escape != 'f' && escape != 'n' && escape != 'r' && escape != 't') {
      return 0;
    }
  }
  return 0;
}

/** Takes one or more digits, or says there are none. */
static int take_digits(Reader *reader) {
  size_t start = reader->at;
  while (reader->at < reader->length && is_digit(reader->bytes[reader->at])) reader->at++;
  return reader->at > start;
}

/** Takes a JSON number, as JSON spells them: no leading zeros, and a digit each side of a dot. */
static int take_number(Reader *reader) {
  (void)take(reader, '-');
  if (!take(reader, '0') && !take_digits(reader)) return 0;
  if (take(reader, '.') && !take_digits(reader)) return 0;
  if (take(reader, 'e') || take(reader, 'E')) {
    if (!take(reader, '+')) (void)take(reader, '-');
    if (!take_digits(reader)) return 0;
  }
  return 1;
}

/** Takes a word JSON knows, such as true, or says it isn't next. */
static int take_word(Reader *reader, const char *word) {
  size_t length = strlen(word);
  if (reader->length - reader->at < length) return 0;
  if (memcmp(reader->bytes + reader->at, word, length) != 0) return 0;
  reader->at += length;
  return 1;
}

/** Takes one JSON value of any kind, or says it isn't a good one. */
static int take_value(Reader *reader, int depth) {
  if (reader->at >= reader->length) return 0;
  unsigned char first = reader->bytes[reader->at];
  if (first == '"') {
    Text text = {0, 0, 0};
    return take_string(reader, &text);
  }
  if (first == 't') return take_word(reader, "true");
  if (first == 'f') return take_word(reader, "false");
  if (first == 'n') return take_word(reader, "null");
  if (first != '{' && first != '[') return take_number(reader);
  if (depth >= DEPTH_LIMIT) return 0;
  unsigned char last = first == '{' ? '}' : ']';
  reader->at++;
  skip_spaces(reader);
  if (take(reader, last)) return 1;
  for (;;) {
    if (first == '{') {
      Text key = {0, 0, 0};
      if (!take_string(reader, &key)) return 0;
      skip_spaces(reader);
      if (!take(reader, ':')) return 0;
      skip_spaces(reader);
    }
    if (!take_value(reader, depth + 1)) return 0;
    skip_spaces(reader);
    if (take(reader, last)) return 1;
    if (!take(reader, ',')) return 0;
    skip_spaces(reader);
  }
}

/** Whether some bytes are one JSON object, with nothing but spaces around it. */
static int is_json_object(const unsigned char *bytes, size_t length) {
  Reader reader = {bytes, length, 0};
  skip_spaces(&reader);
  if (reader.at >= length || bytes[reader.at] != '{') return 0;
  if (!take_value(&reader, 0)) return 0;
  skip_spaces(&reader);
  return reader.at == length;
}

/**
 * The profile open last, from profiles.json, as JSON.parse reads it in the app: the last "open"
 * at the top of the object, when it's a string. The whole file must be good JSON, as the app
 * reads none of it otherwise. The app never writes "open" with an escape in it, so the helper
 * looks only for the key as it is.
 */
static int read_open_profile(const unsigned char *bytes, size_t length, Text *open) {
  Reader reader = {bytes, length, 0};
  int found = 0;
  skip_spaces(&reader);
  if (!take(&reader, '{')) return 0;
  skip_spaces(&reader);
  if (!take(&reader, '}')) {
    for (;;) {
      Text key = {0, 0, 0};
      if (!take_string(&reader, &key)) return 0;
      skip_spaces(&reader);
      if (!take(&reader, ':')) return 0;
      skip_spaces(&reader);
      int is_open = !key.escaped && key.length == 4 && memcmp(bytes + key.start, "open", 4) == 0;
      if (is_open && reader.at < length && bytes[reader.at] == '"') {
        if (!take_string(&reader, open)) return 0;
        found = 1;
      } else {
        if (!take_value(&reader, 1)) return 0;
        if (is_open) found = 0;
      }
      skip_spaces(&reader);
      if (take(&reader, '}')) break;
      if (!take(&reader, ',')) return 0;
      skip_spaces(&reader);
    }
  }
  skip_spaces(&reader);
  return reader.at == length && found;
}

/** The keys a message may have, each with its own bit, so the helper knows which it has had. */
static const struct {
  const char *name;
  unsigned bit;
} KEYS[] = {
    {"type", 1u << 0}, {"url", 1u << 1},  {"site", 1u << 2},    {"company", 1u << 3},
    {"role", 1u << 4}, {"pay", 1u << 5}, {"posting", 1u << 6},
};

/** A message's type. A hello has it alone. */
#define TYPE_KEY (1u << 0)

/** A job has all seven keys. */
#define SAVE_KEYS 0x7Fu

/** A key's bit, or 0 for a key no message has. */
static unsigned key_bit(const unsigned char *name, size_t length) {
  for (size_t at = 0; at < sizeof KEYS / sizeof KEYS[0]; at++) {
    if (strlen(KEYS[at].name) == length && memcmp(KEYS[at].name, name, length) == 0) {
      return KEYS[at].bit;
    }
  }
  return 0;
}

/** What a message is. */
typedef enum { MESSAGE_BAD, MESSAGE_HELLO, MESSAGE_SAVE } Message;

/** What a message's type says it is, from the type's text as it is. */
static Message message_type(const unsigned char *type, size_t length) {
  if (length == 5 && memcmp(type, "hello", 5) == 0) return MESSAGE_HELLO;
  if (length == 4 && memcmp(type, "save", 4) == 0) return MESSAGE_SAVE;
  return MESSAGE_BAD;
}

/**
 * What a message is: a hello, a job, or neither. It must be one JSON object whose values are all
 * strings, with keys of plain lowercase letters, with no escapes, each one a message may have, and
 * none twice. Its type, also with no escapes, is hello, with no other key, or save, with all
 * seven.
 */
static Message read_message(const unsigned char *bytes, size_t length) {
  Reader reader = {bytes, length, 0};
  unsigned seen = 0;
  Message type = MESSAGE_BAD;
  skip_spaces(&reader);
  if (!take(&reader, '{')) return MESSAGE_BAD;
  skip_spaces(&reader);
  for (;;) {
    if (!take(&reader, '"')) return MESSAGE_BAD;
    size_t key_start = reader.at;
    while (reader.at < length && bytes[reader.at] >= 'a' && bytes[reader.at] <= 'z') reader.at++;
    size_t key_length = reader.at - key_start;
    if (!take(&reader, '"')) return MESSAGE_BAD;
    unsigned key = key_bit(bytes + key_start, key_length);
    if (key == 0 || (seen & key) != 0) return MESSAGE_BAD;
    seen |= key;
    skip_spaces(&reader);
    if (!take(&reader, ':')) return MESSAGE_BAD;
    skip_spaces(&reader);
    Text value = {0, 0, 0};
    if (!take_string(&reader, &value)) return MESSAGE_BAD;
    if (key == TYPE_KEY) {
      if (value.escaped) return MESSAGE_BAD;
      type = message_type(bytes + value.start, value.length);
    }
    skip_spaces(&reader);
    if (take(&reader, '}')) break;
    if (!take(&reader, ',')) return MESSAGE_BAD;
    skip_spaces(&reader);
  }
  skip_spaces(&reader);
  if (reader.at != length) return MESSAGE_BAD;
  if (type == MESSAGE_HELLO && seen == TYPE_KEY) return MESSAGE_HELLO;
  if (type == MESSAGE_SAVE && seen == SAVE_KEYS) return MESSAGE_SAVE;
  return MESSAGE_BAD;
}

// Paths. Windows takes them as UTF-16, so a user folder with any characters in its name works,
// and the Mac and Linux as bytes.

#if defined(_WIN32)
typedef wchar_t PathChar;
#define PATH_SEPARATOR L'\\'
/** The highest process ID: a DWORD on Windows. */
#define PID_LIMIT 0xFFFFFFFFu
#else
typedef char PathChar;
#define PATH_SEPARATOR '/'
/** The highest process ID: an int on the Mac and Linux. */
#define PID_LIMIT 0x7FFFFFFFu
#endif

/** A path, with room for any the helper works with. */
typedef struct {
  PathChar text[PATH_LIMIT];
  size_t length;
} Path;

/** Sets a path, or says it's too long. */
static int path_set(Path *path, const PathChar *text) {
  size_t length = 0;
  while (text[length] != 0) {
    if (length + 1 >= PATH_LIMIT) return 0;
    length++;
  }
  memcpy(path->text, text, (length + 1) * sizeof(PathChar));
  path->length = length;
  return 1;
}

/** Adds an ASCII name to a path, after a separator, or says the path would be too long. */
static int path_add(Path *path, const char *name) {
  size_t length = strlen(name);
  if (path->length + 1 + length >= PATH_LIMIT) return 0;
  path->text[path->length] = PATH_SEPARATOR;
  path->length++;
  for (size_t at = 0; at < length; at++) {
    path->text[path->length] = (PathChar)name[at];
    path->length++;
  }
  path->text[path->length] = 0;
  return 1;
}

/** How reading a small file went: read whole, not there, or refused, such as for a link. */
typedef enum { READ_WHOLE, READ_MISSING, READ_REFUSED } ReadResult;

// What the helper asks of the Mac and Linux. Each file in the inbox is reached through the inbox
// folder, opened once, so a link put in the folder's place can't send a file anywhere else.
#if !defined(_WIN32)

/** A profile's inbox, open as a folder. */
typedef struct {
  int folder;
} Inbox;

/** Gets stdin and stdout ready for bytes. They're ready already. */
static int prepare_streams(void) { return 1; }

/** Reads exactly so many bytes from the browser, or says the input ended or failed first. */
static int read_input(unsigned char *bytes, size_t length) {
  while (length > 0) {
    ssize_t got = read(STDIN_FILENO, bytes, length);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return 0;
    bytes += got;
    length -= (size_t)got;
  }
  return 1;
}

/** Writes all of some bytes to a file, however many writes it takes. */
static int write_all(int file, const unsigned char *bytes, size_t length) {
  while (length > 0) {
    ssize_t wrote = write(file, bytes, length);
    if (wrote < 0 && errno == EINTR) continue;
    if (wrote <= 0) return 0;
    bytes += wrote;
    length -= (size_t)wrote;
  }
  return 1;
}

/** Writes some bytes to the browser. */
static int write_output(const unsigned char *bytes, size_t length) {
  return write_all(STDOUT_FILENO, bytes, length);
}

/** The user's own folder: HOME, as the browser passes it on, or else the system's for this user. */
static const char *user_folder(void) {
  const char *home = getenv("HOME");
  if (home != NULL && home[0] == '/') return home;
  struct passwd *user = getpwuid(getuid());
  if (user == NULL || user->pw_dir == NULL || user->pw_dir[0] != '/') return NULL;
  return user->pw_dir;
}

/**
 * The app's data folder, where Electron keeps it for an app named Factwright. A build for the
 * tests takes it from FACTWRIGHT_HELPER_HOME when that's set. The installers' build can't: nothing
 * in its environment can point it anywhere else.
 */
static int find_home(Path *home) {
#if defined(FACTWRIGHT_TESTING)
  const char *testing = getenv("FACTWRIGHT_HELPER_HOME");
  if (testing != NULL && testing[0] != '\0') return path_set(home, testing);
#endif
#if defined(__APPLE__)
  const char *user = user_folder();
  return user != NULL && path_set(home, user) && path_add(home, "Library") &&
         path_add(home, "Application Support") && path_add(home, "Factwright");
#else
  const char *config = getenv("XDG_CONFIG_HOME");
  if (config != NULL && config[0] == '/') {
    return path_set(home, config) && path_add(home, "Factwright");
  }
  const char *user = user_folder();
  return user != NULL && path_set(home, user) && path_add(home, ".config") &&
         path_add(home, "Factwright");
#endif
}

/** Whether a path is a folder, even through a link, as the app's data may have been moved. */
static int is_folder(const Path *path) {
  struct stat info;
  return stat(path->text, &info) == 0 && S_ISDIR(info.st_mode);
}

/** Whether a path is a folder itself, not a link to one somewhere else. */
static int is_real_folder(const Path *path) {
  struct stat info;
  return lstat(path->text, &info) == 0 && S_ISDIR(info.st_mode);
}

/** Whether there's anything at a path. */
static int exists(const Path *path) {
  struct stat info;
  return stat(path->text, &info) == 0;
}

/**
 * Reads a small file that's open, whole, into room for one byte more than the most it takes, so
 * a longer one is refused. Only an ordinary file: never a folder, a device or a pipe.
 */
static ReadResult read_open_file(int file, unsigned char *bytes, size_t room, size_t *length) {
  struct stat info;
  if (fstat(file, &info) != 0 || !S_ISREG(info.st_mode)) return READ_REFUSED;
  size_t total = 0;
  while (total < room) {
    ssize_t got = read(file, bytes + total, room - total);
    if (got < 0 && errno == EINTR) continue;
    if (got < 0) return READ_REFUSED;
    if (got == 0) {
      *length = total;
      return READ_WHOLE;
    }
    total += (size_t)got;
  }
  return READ_REFUSED;
}

/**
 * Reads a small file whole, never through a link. It's opened without waiting, so a pipe in a
 * file's place can't hold the helper up, and refused once it's seen to be one.
 */
static ReadResult read_file(const Path *path, unsigned char *bytes, size_t room, size_t *length) {
  int file = open(path->text, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  if (file < 0) return errno == ENOENT ? READ_MISSING : READ_REFUSED;
  ReadResult result = read_open_file(file, bytes, room, length);
  close(file);
  return result;
}

/**
 * Opens a profile's inbox, making it if it's missing, only for the profile's own user. One that
 * isn't a folder itself, such as a link, is refused.
 */
static int open_inbox(const Path *profile, Inbox *inbox) {
  inbox->folder = -1;
  Path path = *profile;
  if (!path_add(&path, "inbox")) return 0;
  if (mkdir(path.text, 0700) != 0 && errno != EEXIST) return 0;
  inbox->folder = open(path.text, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  return inbox->folder >= 0;
}

static void close_inbox(const Inbox *inbox) { close(inbox->folder); }

/** Reads a small file in the inbox whole, never through a link. */
static ReadResult read_inbox_file(const Inbox *inbox, const char *name, unsigned char *bytes,
                                  size_t room, size_t *length) {
  int file = openat(inbox->folder, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  if (file < 0) return errno == ENOENT ? READ_MISSING : READ_REFUSED;
  ReadResult result = read_open_file(file, bytes, room, length);
  close(file);
  return result;
}

/** Removes a file from the inbox. One that's a link goes itself, never what it points to. */
static void remove_inbox_file(const Inbox *inbox, const char *name) {
  unlinkat(inbox->folder, name, 0);
}

static int is_job_file(const char *name);

/** Counts the jobs waiting in the inbox, up to the most that may wait, or says it can't. */
static int count_jobs(const Inbox *inbox, int *count) {
  int listing = openat(inbox->folder, ".", O_RDONLY | O_DIRECTORY);
  if (listing < 0) return 0;
  DIR *folder = fdopendir(listing);
  if (folder == NULL) {
    close(listing);
    return 0;
  }
  int listed = 1;
  *count = 0;
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(folder);
    if (entry == NULL) {
      listed = errno == 0;
      break;
    }
    if (is_job_file(entry->d_name)) {
      *count += 1;
      if (*count >= INBOX_LIMIT) break;
    }
  }
  closedir(folder);
  return listed;
}

/**
 * Writes a job into the inbox whole, or not at all: to a hidden file made for it alone, never
 * through a link, readable only by its user, then flushed to the disk and renamed into place, so
 * the app never sees half of one. A file left half written is removed.
 */
static int write_inbox_file(const Inbox *inbox, const char *draft, const char *name,
                            const unsigned char *bytes, size_t length) {
  int file = openat(inbox->folder, draft, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (file < 0) return 0;
  int written = write_all(file, bytes, length);
  while (written && fsync(file) != 0) {
    if (errno != EINTR) written = 0;
  }
  if (close(file) != 0) written = 0;
  if (written && renameat(inbox->folder, draft, inbox->folder, name) == 0) return 1;
  unlinkat(inbox->folder, draft, 0);
  return 0;
}

/**
 * Whether a process is running. One that belongs to another user, which the helper may not
 * signal, is running too.
 */
static int process_running(uint32_t pid) {
  return pid > 0 && pid <= PID_LIMIT && (kill((pid_t)pid, 0) == 0 || errno == EPERM);
}

/** The time now, in milliseconds since 1970. */
static uint64_t now_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_REALTIME, &now) != 0 || now.tv_sec < 0) return 0;
  return (uint64_t)now.tv_sec * 1000u + (uint64_t)now.tv_nsec / 1000000u;
}

/** Waits a moment before looking for the app's answer again. */
static void pause_briefly(void) {
  struct timespec moment = {.tv_sec = 0, .tv_nsec = (long)LOOK_EVERY_MS * 1000000L};
  // A signal can cut the wait short, and then it waits out the rest.
  while (nanosleep(&moment, &moment) != 0 && errno == EINTR) {
  }
}

/** Fills some bytes from the system's own random source. */
static int random_bytes(unsigned char *bytes, size_t length) {
#if defined(__APPLE__)
  arc4random_buf(bytes, length);
  return 1;
#else
  while (length > 0) {
    ssize_t got = getrandom(bytes, length, 0);
    if (got < 0 && errno == EINTR) continue;
    if (got <= 0) return 0;
    bytes += got;
    length -= (size_t)got;
  }
  return 1;
#endif
}

// What the helper asks of Windows: the same, with paths in UTF-16 and Windows' own calls.
#else

/** FOLDERID_RoamingAppData, spelled out, so no library has to supply it. */
static const GUID ROAMING_APP_DATA = {
    0x3eb685db, 0x65f9, 0x4cf6, {0xa0, 0x3a, 0xe3, 0xef, 0x65, 0x72, 0x9f, 0x3d}};

/** A profile's inbox, by its path. */
typedef struct {
  Path folder;
} Inbox;

/** The most bytes read or written at once. */
#define IO_CHUNK 65536u

/** Gets stdin and stdout ready for bytes. They'd turn line endings into others otherwise. */
static int prepare_streams(void) {
  return _setmode(_fileno(stdin), _O_BINARY) != -1 && _setmode(_fileno(stdout), _O_BINARY) != -1;
}

/** Reads exactly so many bytes from the browser, or says the input ended or failed first. */
static int read_input(unsigned char *bytes, size_t length) {
  while (length > 0) {
    unsigned int chunk = length < IO_CHUNK ? (unsigned int)length : IO_CHUNK;
    int got = _read(_fileno(stdin), bytes, chunk);
    if (got <= 0) return 0;
    bytes += got;
    length -= (size_t)got;
  }
  return 1;
}

/** Writes some bytes to the browser, however many writes it takes. */
static int write_output(const unsigned char *bytes, size_t length) {
  while (length > 0) {
    unsigned int chunk = length < IO_CHUNK ? (unsigned int)length : IO_CHUNK;
    int wrote = _write(_fileno(stdout), bytes, chunk);
    if (wrote <= 0) return 0;
    bytes += wrote;
    length -= (size_t)wrote;
  }
  return 1;
}

/**
 * The app's data folder, where Electron keeps it for an app named Factwright: Factwright in the
 * user's roaming application data, %APPDATA%. A build for the tests takes it from
 * FACTWRIGHT_HELPER_HOME when that's set. The installers' build can't: nothing in its environment
 * can point it anywhere else.
 */
static int find_home(Path *home) {
#if defined(FACTWRIGHT_TESTING)
  DWORD testing = GetEnvironmentVariableW(L"FACTWRIGHT_HELPER_HOME", home->text, PATH_LIMIT);
  if (testing >= PATH_LIMIT) return 0;
  if (testing > 0) {
    home->length = testing;
    return 1;
  }
#endif
  PWSTR roaming = NULL;
  int found = SUCCEEDED(SHGetKnownFolderPath(&ROAMING_APP_DATA, 0, NULL, &roaming)) &&
              path_set(home, roaming) && path_add(home, "Factwright");
  // Freed even when it failed, as Windows asks.
  CoTaskMemFree(roaming);
  return found;
}

/** Whether a path is a folder, even through a link, as the app's data may have been moved. */
static int is_folder(const Path *path) {
  DWORD attributes = GetFileAttributesW(path->text);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

/** Whether a path is a folder itself, not a link or junction to one somewhere else. */
static int is_real_folder(const Path *path) {
  DWORD attributes = GetFileAttributesW(path->text);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 &&
         (attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

/** Whether there's anything at a path. */
static int exists(const Path *path) {
  return GetFileAttributesW(path->text) != INVALID_FILE_ATTRIBUTES;
}

/**
 * Reads a small file whole, never through a link, into room for one byte more than the most it
 * takes, so a longer one is refused. Others may still change or remove it meanwhile, so the app
 * is never kept from writing its own files.
 */
static ReadResult read_file(const Path *path, unsigned char *bytes, size_t room, size_t *length) {
  HANDLE file = CreateFileW(path->text, GENERIC_READ,
                            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
                            OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (file == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? READ_MISSING
                                                                          : READ_REFUSED;
  }
  ReadResult result = READ_REFUSED;
  BY_HANDLE_FILE_INFORMATION info;
  if (GetFileInformationByHandle(file, &info) &&
      (info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) == 0) {
    size_t total = 0;
    while (total < room) {
      DWORD chunk = room - total < IO_CHUNK ? (DWORD)(room - total) : IO_CHUNK;
      DWORD got = 0;
      if (!ReadFile(file, bytes + total, chunk, &got, NULL)) break;
      if (got == 0) {
        *length = total;
        result = READ_WHOLE;
        break;
      }
      total += got;
    }
  }
  CloseHandle(file);
  return result;
}

/**
 * Opens a profile's inbox, making it if it's missing. One that isn't a folder itself, such as a
 * link or a junction, is refused.
 */
static int open_inbox(const Path *profile, Inbox *inbox) {
  inbox->folder = *profile;
  if (!path_add(&inbox->folder, "inbox")) return 0;
  if (!CreateDirectoryW(inbox->folder.text, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) {
    return 0;
  }
  return is_real_folder(&inbox->folder);
}

static void close_inbox(const Inbox *inbox) { (void)inbox; }

/** Reads a small file in the inbox whole, never through a link. */
static ReadResult read_inbox_file(const Inbox *inbox, const char *name, unsigned char *bytes,
                                  size_t room, size_t *length) {
  Path path = inbox->folder;
  if (!path_add(&path, name)) return READ_REFUSED;
  return read_file(&path, bytes, room, length);
}

/** Removes a file from the inbox. One that's a link goes itself, never what it points to. */
static void remove_inbox_file(const Inbox *inbox, const char *name) {
  Path path = inbox->folder;
  if (path_add(&path, name)) DeleteFileW(path.text);
}

static int is_job_file(const char *name);

/** Whether a file's name, in UTF-16, is a job's. Job names are ASCII. */
static int is_job_file_wide(const wchar_t *name) {
  char ascii[FILE_NAME_ROOM];
  size_t length = 0;
  for (; name[length] != 0; length++) {
    if (length + 1 >= sizeof ascii || name[length] > 0x7F) return 0;
    ascii[length] = (char)name[length];
  }
  ascii[length] = '\0';
  return is_job_file(ascii);
}

/** Counts the jobs waiting in the inbox, up to the most that may wait, or says it can't. */
static int count_jobs(const Inbox *inbox, int *count) {
  Path pattern = inbox->folder;
  *count = 0;
  if (!path_add(&pattern, "*")) return 0;
  WIN32_FIND_DATAW found;
  HANDLE search = FindFirstFileW(pattern.text, &found);
  if (search == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_FILE_NOT_FOUND;
  int listed = 1;
  for (;;) {
    if (is_job_file_wide(found.cFileName)) {
      *count += 1;
      if (*count >= INBOX_LIMIT) break;
    }
    if (!FindNextFileW(search, &found)) {
      listed = GetLastError() == ERROR_NO_MORE_FILES;
      break;
    }
  }
  FindClose(search);
  return listed;
}

/** Writes all of some bytes to a file, however many writes it takes. */
static int write_handle(HANDLE file, const unsigned char *bytes, size_t length) {
  while (length > 0) {
    DWORD chunk = length < IO_CHUNK ? (DWORD)length : IO_CHUNK;
    DWORD wrote = 0;
    if (!WriteFile(file, bytes, chunk, &wrote, NULL) || wrote == 0) return 0;
    bytes += wrote;
    length -= wrote;
  }
  return 1;
}

/**
 * Renames a file, never over another. A virus scanner can hold a new file for a moment, so a
 * rename it blocks is tried again, for up to a second.
 */
static int rename_file(const Path *from, const Path *to) {
  for (int tries = 0; tries < 20; tries++) {
    if (MoveFileExW(from->text, to->text, MOVEFILE_WRITE_THROUGH)) return 1;
    DWORD error = GetLastError();
    if (error != ERROR_ACCESS_DENIED && error != ERROR_SHARING_VIOLATION) return 0;
    Sleep(LOOK_EVERY_MS);
  }
  return 0;
}

/**
 * Writes a job into the inbox whole, or not at all: to a file of its own whose name starts with a
 * dot, which the app leaves alone, and which a link can't stand in for, then flushed to the disk
 * and renamed into place, so the app never sees half of one. A file left half written is removed.
 */
static int write_inbox_file(const Inbox *inbox, const char *draft, const char *name,
                            const unsigned char *bytes, size_t length) {
  Path draft_path = inbox->folder;
  Path name_path = inbox->folder;
  if (!path_add(&draft_path, draft) || !path_add(&name_path, name)) return 0;
  HANDLE file = CreateFileW(draft_path.text, GENERIC_WRITE, 0, NULL, CREATE_NEW,
                            FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  int written = write_handle(file, bytes, length) && FlushFileBuffers(file);
  if (!CloseHandle(file)) written = 0;
  if (written && rename_file(&draft_path, &name_path)) return 1;
  DeleteFileW(draft_path.text);
  return 0;
}

/** Whether a process is running. */
static int process_running(uint32_t pid) {
  if (pid == 0) return 0;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
  if (process == NULL) return 0;
  DWORD code = 0;
  int running = GetExitCodeProcess(process, &code) && code == STILL_ACTIVE;
  CloseHandle(process);
  return running;
}

/** The time now, in milliseconds since 1970. Windows counts in 100 nanoseconds since 1601. */
static uint64_t now_ms(void) {
  FILETIME now;
  GetSystemTimeAsFileTime(&now);
  uint64_t ticks = ((uint64_t)now.dwHighDateTime << 32) | now.dwLowDateTime;
  uint64_t since_1601 = 116444736000000000u;
  return ticks < since_1601 ? 0 : (ticks - since_1601) / 10000u;
}

/** Waits a moment before looking for the app's answer again. */
static void pause_briefly(void) { Sleep(LOOK_EVERY_MS); }

/** Fills some bytes from the system's own random source. */
static int random_bytes(unsigned char *bytes, size_t length) {
  while (length > 0) {
    unsigned int value = 0;
    if (rand_s(&value) != 0) return 0;
    size_t part = length < sizeof value ? length : sizeof value;
    memcpy(bytes, &value, part);
    bytes += part;
    length -= part;
  }
  return 1;
}

#endif

// What the helper does, the same everywhere.

/** Whether a file's name is a waiting job's: 13 digits, a dash, 16 lowercase hex digits, .json. */
static int is_job_file(const char *name) {
  if (strlen(name) != JOB_NAME_LENGTH + 5) return 0;
  for (size_t at = 0; at < 13; at++) {
    if (!is_digit((unsigned char)name[at])) return 0;
  }
  if (name[13] != '-') return 0;
  for (size_t at = 14; at < JOB_NAME_LENGTH; at++) {
    if (!is_lowercase_hex_digit((unsigned char)name[at])) return 0;
  }
  return memcmp(name + JOB_NAME_LENGTH, ".json", 5) == 0;
}

/** Joins a name between two pieces, such as a dot and .tmp, or says it wouldn't fit. */
static int file_name(char *into, const char *before, const char *name, const char *after) {
  size_t lengths[3] = {strlen(before), strlen(name), strlen(after)};
  if (lengths[0] + lengths[1] + lengths[2] >= FILE_NAME_ROOM) return 0;
  memcpy(into, before, lengths[0]);
  memcpy(into + lengths[0], name, lengths[1]);
  memcpy(into + lengths[0] + lengths[1], after, lengths[2]);
  into[lengths[0] + lengths[1] + lengths[2]] = '\0';
  return 1;
}

/**
 * A new job's name: when it came, in milliseconds, so names sort in the order jobs came, then a
 * random part, so two jobs in the same millisecond never share one.
 */
static int new_job_name(char *name) {
  unsigned char random[8];
  if (!random_bytes(random, sizeof random)) return 0;
  // Always 13 digits: a clock set wildly wrong still gives a name the app takes.
  uint64_t ms = now_ms();
  if (ms > 9999999999999u) ms = 9999999999999u;
  for (size_t at = 13; at > 0; at--) {
    name[at - 1] = (char)('0' + (int)(ms % 10u));
    ms /= 10u;
  }
  name[13] = '-';
  static const char hex[] = "0123456789abcdef";
  for (size_t at = 0; at < sizeof random; at++) {
    name[14 + 2 * at] = hex[random[at] >> 4];
    name[15 + 2 * at] = hex[random[at] & 0x0F];
  }
  name[JOB_NAME_LENGTH] = '\0';
  return 1;
}

/** Whether some text is an added profile's ID: 12 lowercase hex digits, as the app makes them. */
static int is_profile_id(const unsigned char *text, size_t length) {
  if (length != 12) return 0;
  for (size_t at = 0; at < length; at++) {
    if (!is_lowercase_hex_digit(text[at])) return 0;
  }
  return 1;
}

/**
 * The folder of the profile open last, as the app reads it (apps/desktop/src/main/profiles.ts):
 * the added profile profiles.json names, while its folder is a folder itself, not a link, with
 * its profile.json in it. Anything else, from "first" to a file that can't be read, is the first
 * profile, whose folder is the app's own.
 */
static void find_profile(const Path *home, Path *profile) {
  static unsigned char note[PROFILES_LIMIT + 1];
  *profile = *home;
  Path file = *home;
  size_t length = 0;
  Text open = {0, 0, 0};
  if (!path_add(&file, "profiles.json")) return;
  if (read_file(&file, note, sizeof note, &length) != READ_WHOLE) return;
  if (!read_open_profile(note, length, &open) || open.escaped) return;
  if (!is_profile_id(note + open.start, open.length)) return;
  char id[13];
  memcpy(id, note + open.start, 12);
  id[12] = '\0';
  Path added = *home;
  if (!path_add(&added, "Profiles") || !path_add(&added, id) || !is_real_folder(&added)) return;
  // The app writes an added profile's profile.json first, so a folder without one was never
  // finished.
  Path kept = added;
  if (!path_add(&kept, "profile.json") || !exists(&kept)) return;
  *profile = added;
}

/** Whether the app is open on this inbox: its marker names a process that's running. */
static int app_listening(const Inbox *inbox) {
  unsigned char marker[LISTENING_LIMIT];
  size_t length = 0;
  if (read_inbox_file(inbox, ".listening", marker, sizeof marker, &length) != READ_WHOLE) return 0;
  // The process ID, in decimal, with any spaces around it.
  size_t start = 0;
  while (start < length && (marker[start] == ' ' || marker[start] == '\t' ||
                            marker[start] == '\n' || marker[start] == '\r')) {
    start++;
  }
  while (length > start && (marker[length - 1] == ' ' || marker[length - 1] == '\t' ||
                            marker[length - 1] == '\n' || marker[length - 1] == '\r')) {
    length--;
  }
  if (start == length) return 0;
  uint64_t pid = 0;
  for (size_t at = start; at < length; at++) {
    if (!is_digit(marker[at])) return 0;
    pid = pid * 10u + (uint64_t)(marker[at] - '0');
    if (pid > PID_LIMIT) return 0;
  }
  // 0 isn't a process: on a Mac or Linux it would ask about the helper's own group instead.
  return pid > 0 && process_running((uint32_t)pid);
}

/** Sends the browser an answer: its length, in four bytes in this computer's order, then it. */
static int send_answer(const unsigned char *answer, size_t length) {
  static unsigned char frame[4 + APP_ANSWER_LIMIT];
  if (length > APP_ANSWER_LIMIT) return 0;
  uint32_t size = (uint32_t)length;
  memcpy(frame, &size, 4);
  memcpy(frame + 4, answer, length);
  return write_output(frame, 4 + length);
}

static int send_text(const char *answer) {
  return send_answer((const unsigned char *)answer, strlen(answer));
}

/**
 * Waits for the open app's answer to a job, and passes it on: up to 3 seconds, looking every
 * 50 milliseconds. The app's answer is removed once it's read, as no one else needs it. One that
 * isn't a JSON object of at most 4096 bytes isn't passed on, nor is a link. Without an answer it
 * can pass on, the job waits for the app, which is open, so it says so: the app adds it in a
 * moment, as once it's done starting.
 */
static int pass_on_answer(const Inbox *inbox, const char *name) {
  static unsigned char answer[APP_ANSWER_LIMIT + 1];
  char done[FILE_NAME_ROOM];
  if (!file_name(done, "", name, ".done")) return send_text(ANSWER_LATER_OPEN);
  for (unsigned look = 0;; look++) {
    size_t length = 0;
    ReadResult found = read_inbox_file(inbox, done, answer, sizeof answer, &length);
    if (found != READ_MISSING) {
      remove_inbox_file(inbox, done);
      if (found != READ_WHOLE || !is_json_object(answer, length)) {
        return send_text(ANSWER_LATER_OPEN);
      }
      Reader trimmed = {answer, length, 0};
      skip_spaces(&trimmed);
      while (length > trimmed.at && (answer[length - 1] == ' ' || answer[length - 1] == '\t' ||
                                     answer[length - 1] == '\n' || answer[length - 1] == '\r')) {
        length--;
      }
      return send_answer(answer + trimmed.at, length - trimmed.at);
    }
    if (look >= ANSWER_WAIT_MS / LOOK_EVERY_MS) return send_text(ANSWER_LATER_OPEN);
    pause_briefly();
  }
}

/**
 * Drops a job into the inbox, unless too many wait there already, then answers: with the app's
 * own answer when it's open, or else that the job waits for it.
 */
static int deliver(const Inbox *inbox, const unsigned char *job, size_t length) {
  int waiting = 0;
  if (!count_jobs(inbox, &waiting)) return send_text(ANSWER_FAILED);
  if (waiting >= INBOX_LIMIT) return send_text(ANSWER_FULL);
  char name[JOB_NAME_LENGTH + 1];
  char draft[FILE_NAME_ROOM];
  char file[FILE_NAME_ROOM];
  if (!new_job_name(name) || !file_name(draft, ".", name, ".tmp") ||
      !file_name(file, "", name, ".json") || !write_inbox_file(inbox, draft, file, job, length)) {
    return send_text(ANSWER_FAILED);
  }
  if (!app_listening(inbox)) return send_text(ANSWER_LATER);
  return pass_on_answer(inbox, name);
}

/** Saves a job for the profile open last, and answers. */
static int save(const unsigned char *job, size_t length) {
  static Path home;
  static Path profile;
  if (!find_home(&home) || !is_folder(&home)) return send_text(ANSWER_NO_FACTWRIGHT);
  find_profile(&home, &profile);
  Inbox inbox;
  if (!open_inbox(&profile, &inbox)) return send_text(ANSWER_FAILED);
  int sent = deliver(&inbox, job, length);
  close_inbox(&inbox);
  return sent;
}

/** The message, which can be up to 1 MiB. */
static unsigned char message[MESSAGE_LIMIT];

/**
 * Reads one message and answers it. Its arguments, which differ by browser, are the browser's
 * own, such as the extension's address. They change nothing: the browser's own check of its
 * registration is what decides who may start the helper.
 */
int main(void) {
  if (!prepare_streams()) return 1;
  unsigned char header[4];
  if (!read_input(header, sizeof header)) return 1;
  uint32_t length = 0;
  memcpy(&length, header, sizeof length);
  // An empty message, or one that stops short, has no answer to give.
  if (length == 0) return 1;
  if (length > MESSAGE_LIMIT) return send_text(ANSWER_TOO_BIG) ? 0 : 1;
  if (!read_input(message, length)) return 1;
  Message kind = read_message(message, length);
  int sent = 0;
  if (kind == MESSAGE_HELLO) {
    sent = send_text(ANSWER_HELLO);
  } else if (kind == MESSAGE_SAVE) {
    sent = save(message, length);
  } else {
    sent = send_text(ANSWER_BAD_MESSAGE);
  }
  return sent ? 0 : 1;
}
