// Texpile's GitHub OAuth app, for signing in to GitHub in the browser (githubAuth.ts). VS Code's
// github-authentication extension keeps its client ID the same way, in code: an OAuth app's client
// ID is public, and the device flow needs no client secret at all.
//
// Empty until the maintainers register the app. To register it: GitHub, Settings, Developer
// settings, OAuth Apps, New OAuth App; any homepage and callback URL (the device flow uses
// neither); then tick "Enable Device Flow" and put the Client ID here, or in the
// TEXPILE_GITHUB_CLIENT_ID environment variable for a build or a test. While it is empty, signing in
// in the browser is not offered, and git's own credential helpers and the token prompt are what
// sign in to GitHub, as before. Never another application's client ID: GitHub shows the app's
// name on the authorization page, and the token would belong to that app.
export const GITHUB_CLIENT_ID: string = process.env.TEXPILE_GITHUB_CLIENT_ID ?? '';
