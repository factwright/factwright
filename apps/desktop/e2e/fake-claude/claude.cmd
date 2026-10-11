@echo off
rem Stands in for Claude Code in the end-to-end tests on Windows. The app finds it first on PATH.
node "%~dp0fake-claude.mjs" %*
