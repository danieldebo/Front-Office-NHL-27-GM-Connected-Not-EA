/**
 * Minimal type stubs for Passport strategy packages that don't publish
 * @types/* entries on DefinitelyTyped.
 */

declare module 'passport-discord' {
  import { Strategy as PassportStrategy } from 'passport';

  export interface Profile {
    id: string;
    username: string;
    global_name?: string;
    email?: string;
    avatar?: string;
    discriminator?: string;
    verified?: boolean;
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope: string[];
  }

  export type VerifyCallback = (
    err: Error | null,
    user?: Express.User | false,
    info?: object,
  ) => void;

  export class Strategy extends PassportStrategy {
    name: string;
    constructor(
      options: StrategyOptions,
      verify: (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
      ) => void,
    );
  }
}

declare module 'passport-microsoft' {
  import { Strategy as PassportStrategy } from 'passport';

  export interface Profile {
    id: string;
    displayName?: string;
    name?: { givenName?: string; familyName?: string };
    emails?: Array<{ value: string; type?: string }>;
    photos?: Array<{ value: string }>;
    _json?: {
      mail?: string;
      userPrincipalName?: string;
      givenName?: string;
      surname?: string;
    };
  }

  export interface StrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope: string[];
    tenant?: string;
  }

  export type VerifyCallback = (
    err: Error | null,
    user?: Express.User | false,
    info?: object,
  ) => void;

  export class Strategy extends PassportStrategy {
    name: string;
    constructor(
      options: StrategyOptions,
      verify: (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback,
      ) => void,
    );
  }
}
