# Setting up Google sign-in (one time, about 10 minutes)

DriveManager needs its own "OAuth client" from Google so that *you* can sign your Google accounts into *your* copy of the app. Nothing here is shared with anyone else: the credentials live only in your `.env` file.

> Google renames menu items from time to time. If a label below doesn't match exactly, look for the closest one.

## 1. Create a project
1. Open <https://console.cloud.google.com/> and sign in with any Google account (it doesn't have to be one you'll connect).
2. Click the project picker at the top, then **New project**. Name it `DriveManager` and create it. Make sure it is selected.

## 2. Turn on the Drive API
1. Menu, **APIs & Services**, **Library**.
2. Search for **Google Drive API**, open it, click **Enable**.

## 3. Configure the consent screen ("Google Auth Platform")
1. Menu, **APIs & Services**, **OAuth consent screen** (newer consoles call it **Google Auth Platform**). Click **Get started** if shown.
2. App name: `DriveManager`. User support email and contact email: your own.
3. **Audience / User type: External.** (Internal only exists for Google Workspace organisations.)
4. **Data Access** (or "Scopes"), **Add or remove scopes**, add:
   `https://www.googleapis.com/auth/drive`
   Save. Google lists this under *restricted scopes*; that is expected, because the app must be able to list, move, rename, upload and delete your files.

## 4. Publishing status: read this, it matters
New projects start in **Testing**. In Testing mode:

* only Google accounts you list under **Test users** can sign in, and
* **Google expires the refresh token after 7 days**, so every account silently disconnects once a week and you must reconnect it. DriveManager shows a red "needs reconnecting" banner when this happens.

For personal use, the practical fix is to open **Audience** and click **Publish app** (status becomes **In production**). Google's documentation says refresh tokens then generally don't expire unless you revoke access or leave them unused for a long time (around six months).

Because you are not going through Google's verification process, Google shows an **"unverified app"** warning the first time you connect each account. That is normal for your own app: click **Advanced**, then **Go to DriveManager (unsafe)**, then allow access. Unverified apps are capped at 100 users, which doesn't matter here. If you'd rather stay in Testing, add each Gmail address under **Test users** and expect the weekly reconnect.

## 5. Create the OAuth client
1. **Credentials** (or **Clients**), **Create credentials / Create client**, **OAuth client ID**.
2. Application type: **Web application**. Name: `DriveManager web`.
3. **Authorized redirect URIs**, add exactly:

   ```
   http://localhost:8000/auth/google/callback
   ```
   (If you changed `APP_PORT`, or you use HTTPS, use that address instead and set the same value as `GOOGLE_REDIRECT_URI` in `.env`.)
4. Create. Copy the **Client ID** and **Client secret**.

## 6. Give them to DriveManager
* Either run `scripts\setup.ps1` again and answer "y" when asked, or
* edit `.env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Then restart: `scripts\start.ps1` (or `docker compose up -d`).

## 7. Connect an account
Open **http://localhost:8000** (it must be this exact address, the one you registered), sign in, go to **Accounts**, click **Connect account**, and pick the Google account. Repeat for each account.

## Opening the app from another device on your network
Google only accepts plain `http://` redirect URIs for `localhost`. To connect accounts while browsing from a phone or another PC, serve the app over HTTPS with a hostname (see `docs/DOCKER.md`, "HTTPS on your LAN"), register `https://<that-hostname>:8443/auth/google/callback` as an additional redirect URI, and set `GOOGLE_REDIRECT_URI` to it. Once accounts are connected, day-to-day use works from any device.

## Troubleshooting
| Message | Cause and fix |
|---|---|
| `redirect_uri_mismatch` | The redirect URI in Google Cloud differs by even one character (port, `http` vs `https`, trailing slash) from `GOOGLE_REDIRECT_URI`. |
| "Access blocked: app has not completed verification" / `access_denied` | The project is in Testing and this account isn't a test user. Add it under **Test users**, or publish the app (step 4). |
| "Google did not return offline access" | Google had already granted the app and sent no refresh token. Remove DriveManager at <https://myaccount.google.com/permissions> and connect again. |
| Account shows "needs reconnecting" a week after connecting | Testing mode's 7-day expiry. Publish the app (step 4), then reconnect once. Also happens if you revoke access or change the Google password in some configurations. |
| Button disabled / "credentials are not set up" | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` in `.env` still holds the placeholder. |
| "Open DriveManager at http://localhost:8000" | You opened the app on a different address than the registered redirect URI. |
