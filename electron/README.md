# Attic Music desktop (Electron)

Thin macOS wrapper around the live web app — it just loads
`https://music.ekskog.me` (override with `ATTIC_URL`), so deploys of the web app
update it with no rebuild. Not part of the Vite app or the Docker/k8s deploy.

Adds one native feature: toggling **mini-player mode** in the app resizes the
window to 380×160 and keeps it on top (`window.attic.setMini`, see
`preload.js`); leaving it restores the previous size. Links to other sites open
in the default browser. localStorage/login are separate from the Safari PWA.

```
cd electron
npm install
npm start          # run it
npm run dist       # builds dist/Attic Music-*.dmg
```

The app is unsigned. First launch on another Mac: right-click → Open, or
`xattr -cr "/Applications/Attic Music.app"`.
