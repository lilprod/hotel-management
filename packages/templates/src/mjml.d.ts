declare module 'mjml' {
  export interface MjmlError {
    line: number;
    message: string;
    tagName: string;
  }
  export interface MjmlOptions {
    validationLevel?: 'strict' | 'soft' | 'skip';
    minify?: boolean;
    keepComments?: boolean;
  }
  /** MJML 5 compiles asynchronously. */
  const mjml2html: (
    input: string,
    options?: MjmlOptions,
  ) => Promise<{ html: string; errors: MjmlError[] }>;
  export default mjml2html;
}
