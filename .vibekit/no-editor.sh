#!/bin/sh
# Written by VibeKit provisioning (configureGit). git's core.editor and
# sequence.editor point here, so no git command can hang on an editor.
echo "This workspace has no editor. Use git commit -m '<message>' (and git rebase without -i)." >&2
exit 1
