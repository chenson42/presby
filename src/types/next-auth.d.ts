import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: string[];
      features: string[];
      isActive: boolean;
      twoFactorRequired: boolean;
      twoFactorVerified: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub?: string;
    roles?: string[];
    features?: string[];
    isActive?: boolean;
    twoFactorRequired?: boolean;
    twoFactorVerified?: boolean;
  }
}

export {};
