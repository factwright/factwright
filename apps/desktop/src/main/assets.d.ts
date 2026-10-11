/** A file the build turns into a data: URL, built into the app. */
declare module '*.woff2?inline' {
  const dataUrl: string;
  export default dataUrl;
}
