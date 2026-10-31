# Likningsspill Web

A browser-native rewrite of Likningsspill, built with Vanilla TypeScript and
Vite. The equation model and game logic are implemented in TypeScript, and the
equation tiles are rendered as DOM elements styled with CSS.

## Development

```sh
npm install
npm run dev
```

## Tests and production build

```sh
npm test
npm run build
npm run preview
```

## GitHub Pages

The GitHub Actions workflow builds the app and deploys `dist/` to GitHub Pages
when changes are pushed to `main`. Vite uses the repository name from
`GITHUB_REPOSITORY` as the Pages base path during CI builds.
