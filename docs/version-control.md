---
description: Texpile keeps versions of your project with git: save a version with a message, see what changed since the last one in a visual diff, restore an older version from the history, and publish and sync the project with GitHub or any other remote.
blurb: Save versions of your project, see what changed, restore an older one, and publish to GitHub.
icon: git-branch
order: 8
section: Editor
---

# Version control

Texpile keeps versions of your project with git, from the Source Control panel. Changes since the last version are listed by file, you tick the ones to include, write what changed, and Save version. History lists every saved version, and any of them can be restored. If the folder is not a repository yet, the panel offers to initialise one, and Publish sends it to GitHub or any other remote.

A new file you never want saved in a version, such as notes or an export, can be left out for good: open its menu in the Changes list and choose Add to .gitignore.

Ctrl+Shift+G (⌃⇧G on a Mac, as in VS Code) opens Source Control with the keyboard in the message box; Show Source Control in the command palette does the same. While the open file differs from its last version, the button beside Visual and Source in the editor's top bar compares the two.

The Source Control icon shows how many files have changed, not counting build output. With nothing to save, the panel's main button is the next thing to do: Sync changes, with the counts each way, or Publish for a branch that has nowhere to go yet.

If the folder is not a repository yet, Source Control offers Initialize Repository and Publish to GitHub. Publish to GitHub starts the repository and adds the build output patterns to .gitignore. When the folder had no .gitignore of its own, it then lists the folder's files and folders, all ticked, as VS Code does: untick anything that should stay on this computer (a private draft, a data file) and it is added to .gitignore. It then saves the rest as the first version and opens the Publish dialog.

If the folder sits inside a larger repository, such as a home folder kept in git or a research repository with the paper in one subfolder, Source Control asks before using it: versions saved there are recorded in that repository with everything else in it. Use that repository, or start one for this folder only. Until you answer, Texpile leaves that repository alone, as VS Code does: no colours in the file tree, no count on the Source Control icon and no marks in the margin. The answer is remembered for the folder.

| Where to find it | Path                    | Note                                     |
| ---------------- | ----------------------- | ---------------------------------------- |
| Panel            | Source Control          | The branch icon in the sidebar header.   |
| In the panel     | Click a changed file    | Opens the diff against the last version. |
| Palette          | Switch to the diff view | Ctrl+K, then type the name.              |

![The Source Control panel: three changed files, the message box, Save version, and the history](../landing/src/lib/assets/showcase/app/source-control-panel.png 'The Source Control panel: three changed files, the message box, Save version, and the history')

## Visual diff

A changed file opens in a diff against the last version. In the visual editor the changes are marked in the formatted text, word by word. In the source editor they are marked line by line.

In the source editor, the margin beside the line numbers marks what changed since the last version as you type: green for added lines, blue for changed ones, and a red wedge where lines were removed. Alt+F5 and Shift+Alt+F5 (also in the command palette) go to the next and previous change. Click a mark to see those lines as they were in the last version, with Undo this change to put back just that change and keep every other edit. Escape closes it. The command palette has the same undo for the change at the cursor.

In a comparison, the arrows in its bar (or Alt+F5 and Shift+Alt+F5 in the source comparison) go to the next and previous change, and Put back beside a change replaces those lines with the version's, leaving the rest of your edits alone.

In the file tree, a changed file's name takes its status colour, a deleted one is struck through in Source Control, a file still being combined carries a red !, and a folder with changes inside it is tinted and marked with a dot, so a changed chapter can be found without opening every folder.

A version in History opens to what differs between it and your files now. To see what that version itself changed, open its menu and choose Show changes in this version: its files are listed with each one's difference from the version before. The same menu copies the version's ID or its full message.

![The visual editor showing a heading and a sentence changed since the last version](../landing/src/lib/assets/showcase/app/diff-view.png 'The visual editor showing a heading and a sentence changed since the last version')

## Milestones

A version that matters, such as the draft sent to your committee or the camera-ready copy, can carry a name. Open the version's menu in History and choose Mark as milestone; the name shows on that row from then on. Milestones are git tags, so other tools see them too. Sync sends them to the remote, and removing one removes it there as well, after asking, since everyone who syncs loses it too.

## Timeline and local history

Every time you save a file, Texpile keeps a copy of it, as VS Code's local history does. This happens in every project, including one that has never used git, and the copies stay on your computer in Texpile's own data, not in the project. The Timeline, below Contents in the explorer, lists the open file's saved copies and its git versions, newest first.

Click an entry to compare it with the file as it is now. An entry's menu also has Compare with Previous, which shows what that save or version changed on its own, restores it (after asking, since unsaved changes are discarded), renames it, or deletes it. The Timeline's own menu creates an entry under a name you choose, chooses whether local history, git history or both are listed, and deletes all local history. Git versions come 50 at a time; Load more at the end of the list brings the next ones.

A file you deleted has no Timeline to open, so its copies are found with Find Entry to Restore, in the Timeline's menu and in the command palette (Ctrl+K). It lists every file in the project that has saved copies, newest first, with deleted ones marked. Pick a file and one of its copies; Restore Contents brings a deleted file back, its folder too, and opens it.

Saves less than 10 seconds apart are kept as one entry. A file keeps its last 50 entries, and files over 256 KB are not kept. Renaming or moving a file takes its entries with it.

## Branches

The branch name at the top of Source Control switches branches. It lists your branches, then the ones that exist only on a remote (choosing one of those makes a branch here that syncs with it). When you are looking at an earlier version rather than a branch (after a checkout in the terminal), the branch name reads Not on a branch, and choosing a branch goes back. Type a name that is not there yet to start a new branch from the current version (spaces become dashes, as in VS Code, so camera ready starts camera-ready); changes you have not saved as a version come along. To delete a branch, point at it in that list and click its bin, as VS Code's Delete Branch does: one whose versions are all on another branch goes at once, and one with versions nowhere else asks first, since they go with it. The branch you are on is never offered. A branch in the remote part of the list is deleted from the remote after asking, since everyone who syncs with that remote loses it too; after you delete a local branch that was published, its copy on the remote shows up there. Switching carries unsaved changes over when it can. When it would overwrite them, Texpile names the files and offers to save everything you changed as a version on the branch you are leaving, then switch; switch back to find it there.

## Publish and sync

Once the project has a version, Publish appears beside the branch name. It sends the project somewhere else: a new GitHub repository, private or public, created for it; a remote the repository already has; or any other repository by its address. With exactly one remote already set up, Publish goes straight there.

After that the button becomes Sync. Sync fetches, takes in versions saved elsewhere, and sends yours, and it shows how many versions go each way. When both sides changed the same lines of a file, Sync undoes the attempt, names the file, and offers to combine them now; nothing changes unless you say yes. When a change that is not saved as a version would be overwritten, Sync stops before anything changes and offers Save a version and sync, which saves everything you changed as a version and then syncs.

The cloud button beside Sync checks the remote for new versions without taking any in, so you can see whether a co-author uploaded before you sync. Texpile also checks on its own every three minutes while its window is in front, as VS Code's automatic fetch does, and says when new versions arrive, with a button to sync, so you can take them in before you start editing. The automatic check never asks you to sign in: it uses a GitHub sign-in or saved password you already have, and when it would need one it stops until your next Sync or check works. Turn it off in Preferences, under Collaboration. Refresh only rereads this computer.

## Combining two versions

Combine now brings in the other side's versions and leaves each place where both sides changed the same lines marked in its file. The file opens in the source editor at the first one, whichever editor you were using: your version is tinted one colour and theirs another, and above each place are Keep mine, Keep theirs and Keep both. The words that differ between the two versions are highlighted in both, so a changed word in a long paragraph stands out. Each choice is one step in the undo history. The bar above the file goes to the previous and next marked place, and Keep all settles every place the same way at once. You can also edit the lines yourself; a place counts as chosen once its `<<<<<<<`, `=======` and `>>>>>>>` lines are gone, and a file still holding any one of those lines is not finished, as in VS Code: a stray `=======` would otherwise print in the PDF. While a file is being combined, the margin shows no change marks in it. A file's tab carries a merge mark while places in it are waiting. A file with no places to click is marked in Source Control instead: Deleted in theirs or Deleted in yours when one side deleted it, and Pick a version for a figure, a PDF or any other file that is not text. Click it and Texpile asks which to keep (Keep my version, Keep their version, or Delete the file), as VS Code does for a deleted file; Finish combining waits until each one is answered. Before, git kept your version of a figure without a word.

Source Control lists the files under Both changed, and marks each one Ready once every place in it is chosen. Finish combining saves the result as one version, which Sync then sends. Cancel combining puts every file back as it was before you started, and the choices go with it.

| While combining  | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| Click a file     | Opens it in the source editor at its first marked place.            |
| Finish combining | Saves the combined files as one version. Waits until each is Ready. |
| Cancel combining | Puts everything back as it was before combining started.            |

A merge started in the terminal gets the same Finish and Cancel. A rebase or cherry-pick left unfinished there is shown in the panel, and is finished or cancelled in the terminal.

## Clone a repository

To work on a project that is already on GitHub or elsewhere, choose Clone repository on the start screen or in the File menu. Paste its address: the repository's page, a page inside it, its clone address, or a `git clone` command from a README all work, and an Overleaf project page is turned into its git address. Choose the folder name and where it goes; the clone shows its progress, asks you to sign in if the repository is private, and opens the folder when it is done.

## Signing in

Texpile signs in with whatever git already uses: Git Credential Manager, the macOS keychain, `gh auth setup-git`, or an SSH key. When none of those has an answer, git's question appears in the window instead of failing: a username and password, an SSH key's passphrase, or whether to trust a server it has not seen before. For GitHub, use a personal access token with the repo scope as the password. A credential manager keeps it after it works, so it is asked for once. Without one, Texpile keeps the username and password (or token) in your system keychain once they have worked, and forgets them if they stop working; Forget saved Git sign-ins in the command palette removes them. On Linux this needs a keyring (GNOME Keyring or KWallet); without one they are kept in memory until you quit Texpile, never written to disk, so you are asked once per session rather than on every Sync.

You can also sign in to GitHub in your browser, as VS Code does. Choose Sign in to GitHub in the command palette, or Sign in with GitHub in your browser when git asks for your GitHub username or token. Texpile shows a one-time code and copies it, and GitHub's page opens so you can paste it there. From then on your GitHub account answers git's questions for Sync, Publish and Fork. The sign-in is kept in your system keychain, and Sign out of GitHub in the command palette ends it. If GitHub stops accepting it, the next upload asks again.

To publish to a new GitHub repository over SSH, tick Upload over SSH in the Publish dialog: the token only creates the repository, and uploads then use the SSH key on your GitHub account.

If you upload to someone else's GitHub repository, GitHub refuses it. Texpile then offers to make your own copy of it (a fork) and upload there; from then on the project syncs with your copy.

The first time you save a version on a computer where git does not know your name and email, Texpile asks for them and saves them for all your projects.

## When something goes wrong

A failed save, sync or publish says what happened in plain words, and Details shows git's own output, with Copy for a bug report or for someone who knows git. Buttons say Saving…, Syncing… or Publishing… while they work, and a thin bar runs across the top of Source Control while git is busy.

- **The folder belongs to another account.** A project on a USB or network drive, or one copied from another user, may belong to a different account on your computer. Git will not work in it until you say you trust it, because a repository's own settings can run programs. Source Control says so and offers Trust this folder, which asks first and then adds the folder to git's `safe.directory` list.
- **A folder full of new files.** A folder of 200 or more new files, such as a data dump or a Python environment, is one row that says how many files it holds. It starts unticked, and its menu can add it to .gitignore. Past 2,000 changes the list stops and says how many there were.
- **GitHub found a secret.** GitHub's push protection refuses an upload that contains what looks like a password, token or key, and Texpile names the file and line. The version that is not uploaded yet still holds it, so taking it out of the file is not enough. If it is not really a secret, Open GitHub's page lets you allow it.
- **A protected branch.** A branch that only takes pull requests refuses uploads. Start a new branch from the branch menu and publish that.
- **Another git is busy.** When another program holds the repository's lock, Texpile tries again, as VS Code does, up to ten times over about twenty seconds, then says what to do if the lock was left behind.

> [!NOTE]
> This covers the everyday loop, from the first version to GitHub. For combining branches and rewriting history, use the built-in terminal. It needs git installed.

[Installing git](installation/git.md)
