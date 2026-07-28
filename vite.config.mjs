// base: './' makes all built asset URLs relative to index.html, so the app can
// be served from any subpath (e.g. drone-tm /mesh)
export default { base: "./", server: { host: true, allowedHosts: [".ts.net"] } };
