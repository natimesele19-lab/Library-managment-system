declare module "mammoth/mammoth.browser" {
  type ConversionResult = { value: string; messages: { type: string; message: string }[] };
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<ConversionResult>;
}
