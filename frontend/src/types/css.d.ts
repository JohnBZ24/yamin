// Metro handles CSS imports on web; TypeScript just needs to know they exist.
// Without this, `import '../global.css'` is a compile error even though the
// bundle builds fine.
declare module '*.css';

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
