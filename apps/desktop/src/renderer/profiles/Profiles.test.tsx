// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProfileEntry } from '../../shared/profiles.ts';
import { ClaudeCard } from '../ClaudeCard.tsx';
import { AddProfileDialog } from './AddProfileDialog.tsx';
import { ManageProfilesDialog } from './ManageProfilesDialog.tsx';
import { ProfileSwitcher } from './ProfileSwitcher.tsx';
import { ProfilesLine } from './ProfilesLine.tsx';

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(cleanup);

const ALEX: ProfileEntry = {
  id: 'first',
  name: 'Alex Rivera',
  open: true,
  first: true,
  named: true,
};
const SAM: ProfileEntry = {
  id: '3f9c2a71d0be',
  name: 'Sam',
  open: false,
  first: false,
  named: true,
};
const TESTING: ProfileEntry = {
  id: 'a84e17c5b2f0',
  name: 'Testing',
  open: false,
  first: false,
  named: true,
};

function switcher(busy = false) {
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  const onManage = vi.fn();
  const view = render(
    <ProfileSwitcher
      profiles={[ALEX, SAM, TESTING]}
      busy={busy}
      onOpen={onOpen}
      onAdd={onAdd}
      onManage={onManage}
    />,
  );
  return { ...view, onOpen, onAdd, onManage };
}

describe('ProfileSwitcher', () => {
  it('shows the open profile, and switches to another from its menu', async () => {
    const user = userEvent.setup();
    const { container, onOpen } = switcher();
    const button = screen.getByRole('button', { name: 'Alex Rivera, switch profiles' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    const menu = screen.getByRole('menu', { name: 'Profiles' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual(['AAlex Rivera', 'SSam', 'TTesting']);
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    // It opens on the profile that's open.
    expect(document.activeElement).toBe(items[0]);
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Sam' }));
    expect(onOpen).toHaveBeenCalledWith(SAM);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves with the arrow keys, and closes with Escape, back on its button', async () => {
    const user = userEvent.setup();
    const { onAdd, onManage } = switcher();
    const button = screen.getByRole('button', { name: 'Alex Rivera, switch profiles' });
    button.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('AAlex Rivera');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('TTesting');
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Manage profiles…');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('AAlex Rivera');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Add a profile…' }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Manage profiles…' }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it('waits to switch while Claude is working, and says so', async () => {
    const user = userEvent.setup();
    const { container, onOpen } = switcher(true);
    await user.click(screen.getByRole('button', { name: 'Alex Rivera, switch profiles' }));
    const sam = screen.getByRole('menuitemradio', { name: 'Sam' });
    expect(sam.getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText('Stop Claude’s run first, as switching restarts Factwright.'),
    ).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(sam);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('closes when the user clicks elsewhere', async () => {
    const user = userEvent.setup();
    switcher();
    await user.click(screen.getByRole('button', { name: 'Alex Rivera, switch profiles' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('AddProfileDialog', () => {
  it('adds a profile, then hands it over to open', async () => {
    const user = userEvent.setup();
    const addProfile = vi.fn(async () => ({ ok: true as const, id: '00000000beef' }));
    const onAdded = vi.fn();
    const { container } = render(
      <AddProfileDialog api={{ addProfile }} busy={false} onAdded={onAdded} onClose={() => {}} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a profile' });
    expect(dialog.textContent).toContain(
      'For someone else, or a fresh start. Looking for two kinds of job? Add one in What you want instead.',
    );
    expect(dialog.textContent).toContain('Profiles aren’t private');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '  Sam   Lee ');
    await user.click(within(dialog).getByRole('button', { name: 'Add and open' }));
    expect(addProfile).toHaveBeenCalledWith('Sam Lee');
    expect(onAdded).toHaveBeenCalledWith({
      id: '00000000beef',
      name: 'Sam Lee',
      open: false,
      first: false,
      named: true,
    });
  });

  it('names the open profile too, the first time, starting from the person’s own name', async () => {
    const user = userEvent.setup();
    const addProfile = vi.fn(async () => ({ ok: true as const, id: '00000000beef' }));
    const { container } = render(
      <AddProfileDialog
        api={{ addProfile }}
        busy={false}
        firstName="Alex Rivera"
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    expect((await axe.run(container)).violations).toEqual([]);
    const own = screen.getByRole('textbox', { name: 'This profile’s name' });
    expect((own as HTMLInputElement).value).toBe('Alex Rivera');
    await user.type(screen.getByRole('textbox', { name: 'New profile’s name' }), 'Sam');
    // Without a name for each, the form asks for one before anything is added.
    await user.clear(own);
    await user.click(screen.getByRole('button', { name: 'Add and open' }));
    expect(addProfile).not.toHaveBeenCalled();
    await user.type(own, 'Alex');
    await user.click(screen.getByRole('button', { name: 'Add and open' }));
    expect(addProfile).toHaveBeenCalledWith('Sam', 'Alex');
  });

  it('says so when adding doesn’t go through, and can try again', async () => {
    const user = userEvent.setup();
    const addProfile = vi
      .fn()
      .mockRejectedValueOnce(new Error('No answer'))
      .mockResolvedValueOnce({ ok: true, id: '00000000beef' });
    const onAdded = vi.fn();
    render(
      <AddProfileDialog api={{ addProfile }} busy={false} onAdded={onAdded} onClose={() => {}} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Add and open' }));
    expect(screen.getByRole('alert').textContent).toBe('The profile couldn’t be added. Try again.');
    await user.click(screen.getByRole('button', { name: 'Add and open' }));
    expect(onAdded).toHaveBeenCalledOnce();
  });

  it('says why a profile couldn’t be added', async () => {
    const user = userEvent.setup();
    const addProfile = vi.fn(async () => ({
      ok: false as const,
      message: 'There’s already a profile called Sam.',
    }));
    const onAdded = vi.fn();
    render(
      <AddProfileDialog api={{ addProfile }} busy={false} onAdded={onAdded} onClose={() => {}} />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'sam');
    await user.click(screen.getByRole('button', { name: 'Add and open' }));
    expect(screen.getByRole('alert').textContent).toBe('There’s already a profile called Sam.');
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('waits while Claude is working, as opening the profile would stop it', () => {
    render(
      <AddProfileDialog
        api={{ addProfile: vi.fn() }}
        busy={true}
        onAdded={() => {}}
        onClose={() => {}}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Add and open' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Stop Claude’s run first, as opening the new profile restarts Factwright.'),
    ).toBeTruthy();
  });
});

describe('ManageProfilesDialog', () => {
  const manage = (profiles = [ALEX, SAM, TESTING]) => {
    const api = {
      renameProfile: vi.fn(async () => ({ ok: true as const })),
      removeProfile: vi.fn(async () => ({ ok: true as const })),
    };
    const onChanged = vi.fn();
    const view = render(
      <ManageProfilesDialog
        api={api}
        profiles={profiles}
        onChanged={onChanged}
        onClose={() => {}}
      />,
    );
    return { ...view, api, onChanged };
  };

  it('removes only profiles that aren’t open, and not the first, once asked twice', async () => {
    const user = userEvent.setup();
    const { container, api, onChanged } = manage([ALEX, { ...SAM, open: true }, TESTING]);
    expect((await axe.run(container)).violations).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Remove Alex Rivera' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Sam' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove Testing' }));
    const confirm = screen.getByRole('group', { name: 'Remove Testing?' });
    expect(confirm.textContent).toContain('goes to the trash, where it can be restored');
    // The safe answer has focus.
    expect(document.activeElement?.textContent).toBe('Keep it');
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(api.removeProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove Testing' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.removeProfile).toHaveBeenCalledWith(TESTING.id);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('renames a profile, and says why a name won’t do', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = manage();
    api.renameProfile.mockResolvedValueOnce({
      ok: false,
      message: 'There’s already a profile called Testing.',
    } as never);
    await user.click(screen.getByRole('button', { name: 'Rename Sam' }));
    const box = screen.getByRole('textbox', { name: 'New name for Sam' });
    expect(document.activeElement).toBe(box);
    await user.clear(box);
    await user.type(box, 'testing{Enter}');
    expect(screen.getByRole('alert').textContent).toBe('There’s already a profile called Testing.');
    await user.clear(box);
    await user.type(box, 'Samantha{Enter}');
    expect(api.renameProfile).toHaveBeenLastCalledWith(SAM.id, 'Samantha');
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename Sam');
  });

  // That Escape leaves the dialog open, the end-to-end tests check: jsdom never closes one.
  it('stops renaming with Escape', async () => {
    const user = userEvent.setup();
    const { api } = manage();
    await user.click(screen.getByRole('button', { name: 'Rename Sam' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Rename Sam');
    expect(api.renameProfile).not.toHaveBeenCalled();
  });

  it('says so when a change doesn’t go through, and can try again', async () => {
    const user = userEvent.setup();
    const { api, onChanged } = manage();
    api.removeProfile.mockRejectedValueOnce(new Error('No answer') as never);
    await user.click(screen.getByRole('button', { name: 'Remove Testing' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('alert').textContent).toBe(
      'That profile couldn’t be removed. Try again.',
    );
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove Testing' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChanged).toHaveBeenCalledOnce();
  });
});

describe('ProfilesLine', () => {
  it('offers a profile for someone else, and once there are several, managing them', async () => {
    const onAdd = vi.fn();
    const onManage = vi.fn();
    const { container, rerender } = render(
      <ProfilesLine profiles={[ALEX]} onAdd={onAdd} onManage={onManage} />,
    );
    expect(container.textContent).toContain('Sharing this computer?');
    expect(screen.queryByRole('button', { name: 'Manage profiles' })).toBeNull();
    screen.getByRole('button', { name: 'Add a profile' }).click();
    expect(onAdd).toHaveBeenCalledOnce();
    rerender(<ProfilesLine profiles={[ALEX, SAM]} onAdd={onAdd} onManage={onManage} />);
    expect(container.textContent).toContain(
      '2 profiles on this computer. This one is Alex Rivera.',
    );
    screen.getByRole('button', { name: 'Manage profiles' }).click();
    expect(onManage).toHaveBeenCalledOnce();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('ClaudeCard, for an added profile', () => {
  it('copies the profile’s own sign-in command when it’s signed out', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async () => ({ ok: true as const }));
    const command = "CLAUDE_CONFIG_DIR='/profiles/sam/claude' claude auth login";
    const { container } = render(
      <ClaudeCard
        status={{ state: 'signed-out', version: '2.1.296' }}
        onRecheck={() => {}}
        signIn={command}
        copy={copy}
        terminal="PowerShell"
      />,
    );
    expect(container.textContent).toContain(
      'This profile has its own Claude login. In PowerShell, run its sign-in command',
    );
    expect(container.textContent).not.toContain('claude auth login');
    await user.click(screen.getByRole('button', { name: 'Copy the command' }));
    expect(copy).toHaveBeenCalledWith(command);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('says to sign in with the profile’s own command once Claude Code is installed', async () => {
    const user = userEvent.setup();
    const copy = vi.fn(async () => ({ ok: true as const }));
    const command = "CLAUDE_CONFIG_DIR='/profiles/sam/claude' claude auth login";
    const { container } = render(
      <ClaudeCard
        status={{ state: 'missing' }}
        onRecheck={() => {}}
        signIn={command}
        copy={copy}
      />,
    );
    // Signing in as the install guide says would sign in the first profile.
    expect(container.textContent).toContain(
      'Then, in Terminal, sign in with this profile’s own command',
    );
    await user.click(screen.getByRole('button', { name: 'Copy the command' }));
    expect(copy).toHaveBeenCalledWith(command);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
