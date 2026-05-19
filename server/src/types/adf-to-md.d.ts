declare module 'adf-to-md' {
  const adfToMd: {
    convert(doc: unknown): { result: string; warnings?: string[] };
  };
  export default adfToMd;
}
