declare module 'tls-sig-api-v2' {
  export class Api {
    constructor(sdkappid: number, key: string);
    genUserSig(userid: string, expire?: number): string;
  }
}
