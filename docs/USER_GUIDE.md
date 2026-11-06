# User guide

How to use each part of DriveManager. For setup, see the [README](../README.md).

- [Keyboard and mouse shortcuts](#keyboard-and-mouse-shortcuts)
- [Dashboard and Analytics](#dashboard-and-analytics)
- [Files](#files)
- [Sharing and moving between accounts](#sharing-and-moving-between-accounts)
- [Deleting and the trash](#deleting-and-the-trash)
- [Uploads](#uploads)
- [Virtual folders](#virtual-folders)
- [Sidebar](#sidebar)
- [Privacy mode and fake names](#privacy-mode-and-fake-names)

## Keyboard and mouse shortcuts

| Shortcut | What it does |
|---|---|
| **Ctrl + K** or **/** | Search everything |
| **Shift + click** a checkbox | Select every file between the last one you ticked and this one |
| **Right-click** a file (long-press on phones) | Actions menu, the same as its ⋮ button. Acts on every selected item if several are selected |
| **Shift + right-click** | The browser's own menu |
| **Esc** | Clear the selection |
| **Alt + ↑ / ↓** on a sidebar item | Move it up or down |
| Click a **column header** | Sort by that column (click again to flip) |
| Double-click a **column edge** | Fit the column to its content |
| Double-click the **sidebar edge** | Switch between full sidebar and icons only |

## Dashboard and Analytics

- The dashboard shows every connected account's **own quota**: used, free and how much is in its trash.
- The combined bar adds them up. **Largest free space** is the biggest single file you can upload, since a file is never split across accounts.
- **Analytics** shows storage over time, what's taking space by file type, the largest files and uploads per day. The charts follow the light/dark theme.

## Files

**Browsing**
- The tabs **My Drive, Shared with me, Shared drives and Trash** each list every account together.
- Filter by account and file type. Sort from the menu or by clicking a column header. Choose **Folders first**, **Files first** or **Mixed**; the choice is remembered.
- **Show all files** (on by default) lists every file in every folder of the current tab as one flat list. The folder each file is in is shown under its name; click it to open that folder. Sorting and filters still apply, so "largest files anywhere" is one click.
- Columns can be resized by dragging their edge. The ⋮ button always stays on the right.

**Opening files**
- Click a file's name to choose **Download** or **Open in Drive**.
- Tick *Remember Download or Open in Drive until I reload the page* and later clicks do that straight away.
- **Share or copy link…** is in the same prompt and is never remembered.
- Google Docs, Sheets and Slides download as Office files or PDF (Google limits these exports to about 10 MB).

**Selecting**
- Ticking files shows a floating bar at the bottom: Add to virtual folder, Move to trash and Delete permanently (in Trash: Restore). The list doesn't move.
- **Shift + click** another checkbox, or the empty part of its row, to select everything in between. Shift + unticking clears that range. This works on the current page.

**Search**
- The search box in the sidebar (🔍 on phones) searches files and folders in every account, at any depth, including Shared with me and shared drives. Results show live on the Files page.

**Other actions**
- Rename, move within the same account, and create folders from the ⋮ menu or right-click.

## Sharing and moving between accounts

**Share…**
- *General access*: **Restricted** or **Anyone with the link** as Viewer, Commenter or Editor. Links are never made searchable.
- Add **specific people** by email with a role and an optional notification email. Change or remove anyone's access.
- **Copy link** copies the Drive link and tells you who can open it.

**Move to another account…**
- Nothing is downloaded. DriveManager first **transfers ownership** to the other account, so the file, its link, comments and sharing stay the same.
- If Google doesn't allow that (for example between a personal account and a Workspace account), it **copies the file inside Google** and moves the original to the old account's trash. The copy has a new link.
- Single files only for now.

## Deleting and the trash

- **Move to trash** works like Google Drive. Restore from the Trash tab.
- **Delete permanently** asks twice. The second step lists every item, with sizes and a total, and unlocks after a 3-second countdown. For items not yet in the trash, the first step also offers **Move to trash instead**.
- **Empty trash** works per account or for all of them at once.

## Uploads

**Starting an upload**
- The blue **Upload files** button in the sidebar (an icon in icons-only mode and on phones) opens the upload dialog.
- It starts where you are: inside a folder it picks that account and folder; in a virtual folder it also adds the files there; otherwise it uses **Automatic**.
- **Drag files from your computer** onto any page except Uploads. The window shows where they'd go, and dropping opens the dialog with the files listed. Nothing uploads until you press **Upload**. Folders can't be dropped; select the files inside instead.

**Where files go**
- **Automatic** (the default) checks your routing rules (Settings → Automatic upload routing) by file type or name, then your account priority, and only picks an account with enough room.
- **Choose an account** sends it exactly where you say. An account you chose is never swapped for another.
- A file is never split across accounts.

**Progress panel**
- Bottom right, like Google Drive's. Each file shows where it's going (**→ account · My Drive / Work / Projects**, or *Choosing account…* while Automatic decides; hover ⓘ for why), a progress ring, ✓ when done, and a 📁 button that opens its folder.
- ⌄ collapses the panel and ✕ closes it. Uploads keep going while you move between pages.
- **Failed** uploads say what went wrong. ↻ offers *Same account (try again)* or another connected account with enough space.
- Uploads **resume** after network drops or restarts and are never duplicated.

## Virtual folders

- Your own folder tree of links to files from any account. Nothing moves in Google Drive.
- Add files with **Add to virtual folder** in Files, or pick a virtual folder when uploading.
- Deleting a virtual folder never touches the files themselves.

## Sidebar

- **Resize** by dragging its right edge. Drag all the way left for icons only; double-click the edge to switch back. Remembered in your browser.
- **Pin** items to a group at the top: hover and click the pin, or right-click (long-press on phones). Pinned items can't be dragged. Dashboard is pinned by default.
- **Reorder** the rest by dragging, with **Alt + ↑/↓**, or in **Settings → Sidebar**, which also works on phones and has **Reset order and pins**. The order is saved on the server, so it's the same on every device.
- **Sync now** re-indexes every connected account and shows progress. Accounts also sync on their own schedule.
- **Settings** is the gear icon at the bottom, between the theme switch and Sign out.

## Privacy mode and fake names

Both only change what's on screen. Nothing on the server, in Google Drive or in the logs changes.

- **Privacy mode** (sidebar switch) replaces every email address with a stable alias such as `user-k3f9x2`, and hides Google display names. Account colours stay the same, so accounts are still easy to tell apart.
- **Fake file and folder names** (Settings → Developer) shows every file, folder, shared drive and virtual folder name as a made-up name from ordinary words, such as *Quarterly Garden Plan.pdf*. The same name always gets the same fake name, and the extension and icon stay.
  - Search still matches the real names, sorting uses them, and sizes and storage are real.
  - The Rename dialog shows the real name, so a fake one is never saved.
  - A small **Demo** tag on the sidebar logo shows while it's on.
- Turn both on for screenshots, recordings and screen sharing. Each is saved per browser.
