---
description: Texpile keeps versions of your project with git: save a version with a message, see what changed since the last one in a visual diff, restore an older version from the history, and publish and sync the project with GitHub or any other remote.
blurb: Save versions of your project, see what changed, restore an older one, and publish to GitHub.
icon: git-branch
order: 8
section: Editor
---

# Version control

Texpile keeps versions of your project with git, from the Source Control panel. Changes since the last version are listed by file, you tick the ones to include, write what changed, and Save version. History lists every saved version, and any of them can be restored. If the folder is not a repository yet, the panel offers to initialise one, and Publish sends it to GitHub or any other remote.

The Source Control icon shows how many files have changed. With nothing to save, the panel's main button is the next thing to do: Sync changes, with the counts each way, or Publish for a branch that has nowhere to go yet.

If the folder sits inside a larger repository, such as a home folder kept in git or a research repository with the paper in one subfolder, Source Control asks before using it: versions saved there are recorded in that repository with everything else in it. Use that repository, or start one for this folder only. The answer is remembered for the folder.

| Where to find it | Path                    | Note                                     |
| ---------------- | ----------------------- | ---------------------------------------- |
| Panel            | Source Control          | The branch icon in the sidebar header.   |
| In the panel     | Click a changed file    | Opens the diff against the last version. |
| Palette          | Switch to the diff view | Ctrl+K, then type the name.              |

![The Source Control panel: three changed files, the message box, Save version, and the history](../landing/src/lib/assets/showcase/app/source-control-panel.png 'The Source Control panel: three changed files, the message box, Save version, and the history')

## Visual diff

A changed file opens in a diff against the last version. In the visual editor the changes are marked in the formatted text, word by word. In the source editor they are marked line by line.

In the source editor, the margin beside the line numbers marks what changed since the last version as you type: green for added lines, blue for changed ones, and a red wedge where lines were removed. Alt+F5 and Shift+Alt+F5 (also in the command palette) go to the next and previous change.

A version in History opens to what differs between it and your files now. To see what that version itself changed, open its menu and choose Show changes in this version: its files are listed with each one's difference from the version before.

![The visual editor showing a heading and a sentence changed since the last version](../landing/src/lib/assets/showcase/app/diff-view.png 'The visual editor showing a heading and a sentence changed since the last version')

## Milestones

A version that matters, such as the draft sent to your committee or the camera-ready copy, can carry a name. Open the version's menu in History and choose Mark as milestone; the name shows on that row from then on. Milestones are git tags, so other tools see them too. Sync sends them to the remote, and removing one removes it there as well.

## Branches

The branch name at the top of Source Control switches branches. It lists your branches, then the ones that exist only on a remote (choosing one of those makes a branch here that syncs with it). Type a name that is not there yet to start a new branch from the current version; changes you have not saved as a version come along. Switching carries unsaved changes over when it can. When it would overwrite them, Texpile names the files and offers to save everything you changed as a version on the branch you are leaving, then switch; switch back to find it there.

## Publish and sync

Once the project has a version, Publish appears beside the branch name. It sends the project somewhere else: a new GitHub repository, private or public, created for it; a remote the repository already has; or any other repository by its address. With exactly one remote already set up, Publish goes straight there.

After that the button becomes Sync. Sync fetches, takes in versions saved elsewhere, and sends yours, and it shows how many versions go each way. When both sides changed the same lines of a file, Sync undoes the attempt, names the file, and offers to combine them now; nothing changes unless you say yes. When a change that is not saved as a version would be overwritten, Sync stops before it starts and asks you to save a version first.

## Combining two versions

Combine now brings in the other side's versions and leaves each place where both sides changed the same lines marked in its file. The file opens in the source editor at the first one, whichever editor you were using: your version is tinted one colour and theirs another, and above each place are Keep mine, Keep theirs and Keep both. The words that differ between the two versions are highlighted in both, so a changed word in a long paragraph stands out. Each choice is one step in the undo history. The bar above the file goes to the previous and next marked place, and Keep all settles every place the same way at once. You can also edit the lines yourself; a place counts as chosen once its `<<<<<<<`, `=======` and `>>>>>>>` lines are gone. A file's tab carries a merge mark while places in it are waiting.

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

Texpile signs in with whatever git already uses: Git Credential Manager, the macOS keychain, `gh auth setup-git`, or an SSH key. When none of those has an answer, git's question appears in the window instead of failing: a username and password, an SSH key's passphrase, or whether to trust a server it has not seen before. For GitHub, use a personal access token with the repo scope as the password. A credential manager keeps it after it works, so it is asked for once. Without one, Texpile keeps the username and password (or token) in your system keychain once they have worked, and forgets them if they stop working; Forget saved Git sign-ins in the command palette removes them. On Linux this needs a keyring (GNOME Keyring or KWallet); without one nothing is kept.

To publish to a new GitHub repository over SSH, tick Upload over SSH in the Publish dialog: the token only creates the repository, and uploads then use the SSH key on your GitHub account.

If you upload to someone else's GitHub repository, GitHub refuses it. Texpile then offers to make your own copy of it (a fork) and upload there; from then on the project syncs with your copy.

The first time you save a version on a computer where git does not know your name and email, Texpile asks for them and saves them for all your projects.

> [!NOTE]
> This covers the everyday loop, from the first version to GitHub. For combining branches and rewriting history, use the built-in terminal. It needs git installed.

[Installing git](installation/git.md)
