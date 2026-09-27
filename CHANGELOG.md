# Changelog

Release notes for Texpile Desktop. Add notes under `## [Unreleased]` as you work; run
`pnpm --filter texpile-editor release <patch|minor|major>` to cut a dated, numbered release.

## [Unreleased]

- feat: delete branches from the branch list, as VS Code does: a branch whose versions are elsewhere goes at once, one with versions nowhere else asks first, and a branch on the remote is deleted there after asking
- feat: Publish to GitHub from a folder with no .gitignore asks which files and folders to include, as VS Code does; unticked ones are added to .gitignore
- fix: a repository in a folder above the project colours nothing, counts nothing and marks nothing until you choose to use it, as in VS Code
- fix: a leftover `=======` line also keeps a file from counting as settled, as in VS Code; a file being combined shows no change marks in the margin
- fix: a new branch name with spaces is made into one with dashes instead of being refused
- fix: a repository locked by another git is retried up to ten times, for every change Texpile makes, as VS Code does; Restore no longer drops a file when the lock outlasts that
- fix: the Source Control progress bar appears at once and stays a moment after git finishes, so steps run back to back read as one
- feat: a git version's menu in the Timeline copies its message

- feat: while combining, a file one side deleted or a figure both sides changed asks which version to keep (Keep my version, Keep their version, Delete the file), and Finish combining waits for the answer
- feat: Timeline: Compare with Previous shows what one save or version changed; Find Entry to Restore (Timeline menu and palette) lists every file with local history, deleted ones included, and brings a deleted file back
- feat: Texpile checks for co-authors' new versions every three minutes while in front and says when some arrive, without ever asking for a sign-in; Preferences > Collaboration turns it off

- fix: Timeline: a version from before a rename opens under the file's name then, and Load more reaches versions past the first 50
- fix: Save version keeps a rename whole, takes in a file whose conflicts are all chosen after a stash, and waits while a place is still marked
- fix: Discard puts back changes staged in a terminal; a file staged as new, or the new name of a rename, goes to the Trash; where there is no Trash it asks before deleting outright
- fix: a repository inside the project is left out of the changes list, and a folder row that also holds ignored files is never deleted whole
- fix: a stray `<<<<<<<` or `>>>>>>>` line keeps a file from counting as settled
- fix: a branch deleted on the remote (a merged pull request's) offers Publish again instead of failing on every Sync
- fix: a clone whose submodule cannot be fetched opens, and says what is missing, instead of reporting nothing at the address
- fix: removing a milestone asks first; Publish before a first version says so instead of creating an empty GitHub repository
- fix: an SSH key refused while publishing no longer signs you out of GitHub, a fork is reached the way the original was (SSH or HTTPS), and the palette shows who is signed in now
- fix: Local History keeps every copy if its listing is lost, and a rename's entry holds the file as it is on disk

- feat: sign in to GitHub in the browser with a one-time code (VS Code's device flow); the account answers git for Sync, Publish and Fork, and Sign out of GitHub ends it.
- feat: local history: every save keeps a copy (as in VS Code), listed with the file's git versions in a new Timeline below Contents, with compare, restore, rename, delete and create entry; it works in projects without git
- feat: a progress bar runs across Source Control while git works
- feat: comparisons have previous and next change buttons (Alt+F5 and Shift+Alt+F5 in the source comparison) and Put back beside each change
- feat: a file both sides changed can be kept whole from its menu, mine or theirs, for figures, PDFs and files one side deleted
- feat: folders with changes inside are tinted and dotted in the file tree; a file still being combined shows a !, and deleted files are struck through in Source Control
- feat: Publish to GitHub from a folder that is not a repository yet: it initialises, ignores build output, saves a first version and opens Publish
- feat: Check for new versions beside Sync fetches without taking anything in; Sync blocked by unsaved work offers Save a version and sync
- feat: Ctrl+Shift+G (⌃⇧G on macOS) and Show Source Control in the palette open the panel with the keyboard in the message box
- feat: a Compare with the last version button in the editor's top bar while the open file has changes
- fix: the branch name says Not on a branch (at …) after checking out an earlier version, instead of "HEAD"
- fix: the Source Control badge no longer counts build output
- fix: a repository in a folder another account owns (a USB or network drive) is no longer called "not a repository"; Source Control explains it and offers Trust this folder
- feat: a folder of 200 or more new files is one row with its count and Add folder to .gitignore; past 2,000 changes the list stops and says so
- feat: GitHub's push protection and protected branches are explained in plain words, with the file and line push protection found
- feat: failed saves, syncs and publishes say what to do next, with git's own output behind Details; Save version, Sync and Publish say Saving…, Syncing… and Publishing… while they work
- fix: a Save version or discard that meets another git's lock tries once more before failing
- fix: an edit waiting for autosave in a file that was not changed on disk yet is included in the version being saved
- feat: clicking a change mark in the source editor's margin shows what those lines were in the last version, with Undo this change
- feat: a new file's menu in Source Control adds it to .gitignore; a version's menu in History copies its ID or its full message
- feat: Publish sends a project to a new GitHub repository, a remote it already has, or any repository by address
- feat: Sync takes in versions saved elsewhere and sends yours, and undoes the attempt rather than leave a conflict behind
- feat: git's sign-in questions (a password or token, an SSH key's passphrase, a server it has not seen) are asked in the window instead of failing
- feat: the first version saved on a computer asks for the name and email git records, once
- feat: switching branches over changes that would be overwritten offers to save them as a version first, then switch
- feat: the Source Control icon counts changed files, and with nothing to save the panel offers Sync or Publish as its main button
- feat: combining highlights the words that differ between the two versions, goes from one marked place to the next, keeps one side everywhere at once, and marks the file's tab
- feat: without a credential helper, sign-ins that worked are kept in the system keychain instead of being asked for on every upload; Forget saved Git sign-ins removes them
- feat: an upload GitHub refuses because the repository is someone else's offers to fork it and upload there
- feat: Publish to a new GitHub repository can upload over SSH
- feat: milestones: name a version in History ("Sent to the committee"); Sync carries them to the remote, and removing one removes it there too
- feat: the source editor marks lines added, changed or removed since the last version in its margin; Alt+F5 and Shift+Alt+F5 go to the next and previous change
- feat: the branch name in Source Control switches branches, starts a new one, or takes up one that exists only on a remote
- feat: Clone repository, on the start screen and in the File menu, takes a repository's page, clone address or `git clone` command, shows its progress, and opens the folder
- feat: Show changes in this version, in a History row's menu, lists what that version changed and each file's difference from the version before
- fix: a folder inside a larger repository asks before its versions are saved into that repository
- feat: when Sync finds both sides changed the same lines, Combine now marks each place in the file with Keep mine, Keep theirs and Keep both, and Finish combining saves the result as one version (Cancel puts everything back)
- fix: uploading uses the credential helpers and settings in your global git config
- fix: saving a version while git's index was briefly locked could record every unticked file as deleted
- fix: a new repository starts on `main`, as GitHub does, unless git is configured with another default
- fix: files you untick in Source Control stay unticked when you switch the sidebar away and back
- fix: an unfinished merge, rebase or cherry-pick is shown, its conflicted files are kept out of the next version, and Save version, Restore and Sync wait for it
- fix: restoring an old version brings back a file renamed since, instead of losing it
- fix: without git installed, Source Control says so and can check again instead of offering a button that fails
- fix: commits, fetches and checkouts made in the terminal show up in Source Control without a refresh
- fix: discarding a file that was never saved as a version moves it to the Trash
- fix: `\overline`, `\sqrt`, `\hat` and similar typed in the visual math editor put the caret inside them instead of after an empty box (by @hkarlsen06)
- feat: shift-enter in a display equation starts a new one of the same kind below it (by @hkarlsen06)

## [1.2.0] - 2026-09-25

- feat: suggestion mode (by @louisqli)
- feat: side by side comments (by @louisqli)
- feat: collaboration tab in preferences (by @louisqli)
- feat: allow switching between distributions (by @louisqli)
- feat: right click an open tab to show right-click menu (by @louisqli)
- feat: control/command-shift-t reopens closed tab (by @louisqli)
- feat: justified text in the visual editor (Knuth-Plass line breaks and hyphenation) (by @louisqli)
- feat: transparent themes available (by @louisqli)
- feat: a welcome screen (by @louisqli)
- feat: Refine rewrites selected text with an AI agent already on your computer (by @louisqli)
- fix: version check before collaborations (by @louisqli)
- fix: up and down arrows keep their column in the visual editor (by @louisqli)
- fix: various visual editor improvements and bug fixes (by @louisqli)
- fix: improved dragging experience for visual editor (by @louisqli)
- fix: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z work when the text is not focused (by @louisqli)
- fix: live preview will not fall back to recompile when typing fast (by @louisqli)
- fix: visual editor now supports synctex jumping (by @louisqli)
- fix: `^` in the visual math editor no longer turns into `\^` on Nordic and German Macs after typing a backslash (by @hkarlsen06)
- fix: `\boxed` and black math in the visual editor are visible in dark themes (by @hkarlsen06)
- fix: various other minor issues (by @louisqli)

## [1.1.0] - 2026-09-10

- fix: Typst completion issues after a `.`
- fix: switching languages now reopens the workspace
- fix: enabled differential updates
- feat: LaTeX and Typst auto-close pairs such as `{}` and `` `' ``
- feat: recompile from scratch and clean auxiliary files for LaTeX
- feat: copying and pasting in the terminal via right-click and keybindings
- feat: the PDF preview refreshes automatically even when the document is compiled externally

## [1.0.2] - 2026-09-09

- fix: 1.0.1 portable build and installed windows build update issue.

## [1.0.1] - 2026-09-08

- feat: Brazilian Portuguese interface language by @ale4-dev
- feat: portable Windows build
- fix: #22
- fix: #23

## [1.0.0] - 2026-09-07

- fix: live mode is no longer marked experimental in the compile
- fix: improve memory usage
- fix: improved editing large documents in visual mode
- fix: fix visual mode displaying no elements on extreme verbatim environments
- fix: improved visual editing cursor handling
- fix: reduced height of pdf preview

## [1.0.0-rc.4] - 2026-09-04

- fix: MCP now give assistant tools to fix issues regarding comments when editing files
- fix: a comment whose surrounding words changed shows a Check placement badge instead of silently sitting on another copy of its sentence
- feat: Ctrl+T (Cmd+T on macOS) opens the file picker, and the palette's file rows show the explorer's icons
- fix: Ctrl+W closes a tab whose file could not be loaded, such as one deleted on disk
- fix: UI freeze in cold start
- fix: improve contrast in all themes

## [1.0.0-rc.3] - 2026-09-03

- fix: various improvements to align with Apple's design guidances on macOS
- fix: various UI improvements
- feat: a lot more theme (check it out at File > Preferences)

## [1.0.0-rc.2] - 2026-09-01

- fix: link not showing on click
- fix: UI inconsistency
- fix: search bar does not auto-focus

## [1.0.0-rc.1] - 2026-09-01

- feat: guest able to join a shared session from the browser (join.texpile.com)
- feat: open a single file (.tex, .typ ...etc)
- fix: various fixes and improvements to LaTeX live preview
- fix: various improvements to the visual editor
- fix: various improvement to .bib editor
- fix: faster startup and various performance optimizations

## [0.17.1] - 2026-08-19

- feat: Typst tables in the visual editor: merge and split cells, and drag to resize columns
- feat: Typst completions, hover help, and live error underlines for guests in a shared session, with no Typst tools installed on their machine
- fix: accepting a Typst completion could leave the cursor before the inserted word
- fix: LaTeX and Markdown tables no longer show a column resize handle that could not be saved
- fix: removed the legacy window size warning

## [0.17.0] - 2026-08-15

- feat: Typst support: visual editor, tinymist live preview, and click-to-jump sync in both directions
- feat: visual Markdown editing
- feat: review comments on LaTeX, Markdown and Typst documents, also in shared sessions
- feat: Zotero citation integration: insert citations from the right-click menu or command palette, with a toggle in the new Integrations preferences tab
- feat: undo/redo for file tree operations
- feat: project build settings now live in .texpile/config.json inside the workspace and migrate automatically from 0.16.1
- feat: many UI enhancements
- fix: many collaboration, editor, and preview stability fixes

## [0.16.1] - 2026-08-02

- feat: the editor remembers where you left off in each file, across tab switches and restarts
- feat: toolbars fold into a "..." when the window is narrow, instead of putting buttons out of reach
- fix: math symbols insert reliably from the toolbar, and equations no longer steal the cursor

## [0.16.0] - 2026-07-31

- feat: a command palette on Ctrl+K (Cmd+K on macOS) to open a file, compile, and run editor actions without leaving the keyboard. The file name in the middle of the title bar opens it too
- feat: Vim and Emacs keybindings for the source editor, chosen in Preferences
- feat: multiple cursors in the source editor: Ctrl+Alt+Up and Ctrl+Alt+Down add a cursor, Ctrl+D selects the next occurrence
- feat: the window title bar is now part of the app, putting the menus, the file name, and the window buttons on one row; the menus fold into a single button as the window narrows. macOS keeps its native menu bar and traffic lights
- feat: connect Claude and other AI assistants to the editor over MCP, set up from Preferences
- feat: large documents open, scroll, and type faster
- feat: on Windows and Linux the window buttons are drawn by the system, so hovering Maximise on Windows 11 offers the snap layouts
- fix: live mode no longer showed a blank grey page for any document that picks its font with fontspec. A family name containing a space, such as Times New Roman, made the page unreadable to the preview; this affected every language, English included
- fix: Hebrew and Arabic render in live mode, reading right to left, with Arabic letters joined
- fix: Greek, Cyrillic, and Japanese, Chinese, and Korean text render in live mode, including fonts taken from a TrueType collection
- fix: live mode reports compile errors in the Problems panel. A document that still produced pages could fail silently, with nothing anywhere to say why
- fix: typing in a right-to-left document no longer recompiles on every keystroke
- fix: the macOS menu bar was missing every menu but Edit, and Window and Help were left in English
- fix: in a shared session the PDF preview no longer stops working partway through
- fix: guests in a shared session have the menus, with the actions a guest cannot perform left out
- fix: the file explorer refreshes when you open another folder from within a workspace
- fix: two compiles can no longer run at once and overwrite each other's output
- fix: compiling no longer opens an empty terminal alongside the compile output

## [0.15.0] - 2026-07-22

- feat: experimental shared sessions for real time collaboration. Share a folder with a code from the home screen, no account needed, end to end encrypted so the relay server only forwards data it cannot read. Guests co-edit in both the visual and source editors, see where others are editing, and watch the host's compiled PDF and compile problems live
- feat: work in several windows, with File > New Window and Open Folder in New Window; relaunching reopens every window on its last open file
- feat: the app and the website are available in Simplified Chinese, Traditional Chinese, and German, picked in Preferences
- feat: open files appear as tabs above the editor, and your open tabs come back when you reopen the folder
- feat: the file explorer gains multi-select and drag and drop: select several files with Ctrl and Shift, drop files and folders in from your system's file manager, and paste images or copied files with Ctrl+V

## [0.14.3] - 2026-07-18

- fix: the What's new, update, and Preferences windows scroll long content instead of pushing their buttons off screen, and Esc closes them
- fix: arrow keys no longer open autocomplete while moving the cursor
- feat: automatic update notices wait until a release is 3 hours old; a manual check from the menu shows it right away
- feat: the keyboard shortcuts window lists the source editor keys (go to definition, suggestions, math preview)

## [0.14.2] - 2026-07-18

- feat: spell check works in the source editor, checking prose but not commands, math, or comments
- feat: autocomplete knows package and class names, per-package options and key-values, and bib entry types
- feat: autocomplete suggests labels with their numbers, your macros, and glossary entries from every file in the project
- feat: go-to-definition and hover work across files, and citation suggestions are searchable
- feat: accepting a macro that takes an argument reopens the suggestions for that argument
- feat: the math preview renders your own macros and can be dismissed with a click or Esc, with a Preferences toggle
- fix: compile problems are read more accurately from MikTeX, pdfTeX, and dvipdfmx logs, and squiggles land on the exact token
- feat: bibliography warnings jump to the entry in the .bib file
- fix: reading the compile log no longer stalls the app on large documents
- feat: reopening the last workspace also restores the last open file
- feat: live mode renders exact pages at rest, and large documents only paint the pages in view
- feat: live mode covers footnotes, beamer slides, tables inside floats, CJK text, and classic math fonts
- fix: steadier typing in live mode, with fewer misplaced or drifting edits
- fix: the Linux deb launches on Ubuntu 24.04 and newer
- fix: the app icon appears in the Ubuntu launcher, and the Linux dock says Texpile instead of Texpile-desktop

## [0.14.1] - 2026-07-17

- fix: the source editor's line numbers sit between the warning and fold columns, so they no longer have a gap beside them
- fix: double-clicking a line number or a fold arrow no longer selects it

## [0.14.0] - 2026-07-16

- feat: the source editor gets a table inserter and a math symbol palette
- feat: autocomplete completes more macros and opens with a single backslash
- feat: a new .tex in source mode offers a document skeleton you can take with Tab
- feat: the terminal can shrink to the editor width
- fix: File > New waits for you to name the file instead of creating untitled.tex before you can type
- fix: switching files no longer flashes a placeholder before the editor appears
- fix: the math symbol palette no longer disappears when switching between symbol groups
- fix: the line number column keeps a steady width

## [0.13.2] - 2026-07-15

- feat: the What's New window shows the current release series on new installs and upgrades from older versions

## [0.13.1] - 2026-07-15

- fix: applying a highlight or text color to selected text froze the app
- feat: updates now download and install from inside the app

## [0.13.0] - 2026-07-14

- feat: added live mode, allowing real-time preview of LuaLaTeX compilation
- feat: various minor improvements to the user experience
