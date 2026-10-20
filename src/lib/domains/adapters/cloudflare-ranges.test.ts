import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_IPV4_RANGES,
  CLOUDFLARE_IPV6_RANGES,
  ipv4InCidr,
  ipv6InCidr,
  isCloudflareAddress,
  isNonPublicAddress,
} from "./cloudflare-ranges";

describe("ipv4InCidr", () => {
  it("matches the boundaries of a /20, /22 and /13", () => {
    expect(ipv4InCidr("173.245.48.0", "173.245.48.0/20")).toBe(true);
    expect(ipv4InCidr("173.245.63.255", "173.245.48.0/20")).toBe(true);
    expect(ipv4InCidr("173.245.64.0", "173.245.48.0/20")).toBe(false);
    expect(ipv4InCidr("173.245.47.255", "173.245.48.0/20")).toBe(false);
    expect(ipv4InCidr("104.16.0.1", "104.16.0.0/13")).toBe(true);
    expect(ipv4InCidr("104.23.255.255", "104.16.0.0/13")).toBe(true);
    expect(ipv4InCidr("104.24.0.0", "104.16.0.0/13")).toBe(false);
  });
  it("handles /0, /32 and refuses malformed input", () => {
    expect(ipv4InCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(ipv4InCidr("1.2.3.4", "1.2.3.4/32")).toBe(true);
    expect(ipv4InCidr("1.2.3.5", "1.2.3.4/32")).toBe(false);
    for (const bad of ["", "1.2.3", "256.0.0.1", "a.b.c.d", "1.2.3.4.5", "::1"]) {
      expect(ipv4InCidr(bad, "10.0.0.0/8"), bad).toBe(false);
    }
    expect(ipv4InCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
    expect(ipv4InCidr("10.0.0.1", "garbage")).toBe(false);
  });
});

describe("ipv6InCidr", () => {
  it("matches inside and outside a /32 and a /29", () => {
    expect(ipv6InCidr("2606:4700::1", "2606:4700::/32")).toBe(true);
    expect(ipv6InCidr("2606:4700:ffff::1", "2606:4700::/32")).toBe(true);
    expect(ipv6InCidr("2606:4701::1", "2606:4700::/32")).toBe(false);
    expect(ipv6InCidr("2a06:98c0::1", "2a06:98c0::/29")).toBe(true);
    expect(ipv6InCidr("2a06:98c7:ffff::1", "2a06:98c0::/29")).toBe(true);
    expect(ipv6InCidr("2a06:98c8::1", "2a06:98c0::/29")).toBe(false);
  });
  it("expands :: correctly and refuses malformed input", () => {
    expect(ipv6InCidr("::1", "::1/128")).toBe(true);
    expect(ipv6InCidr("::2", "::1/128")).toBe(false);
    expect(ipv6InCidr("fe80::1", "fe80::/10")).toBe(true);
    for (const bad of ["", "1.2.3.4", "1::2::3", "gggg::1", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7"]) {
      expect(ipv6InCidr(bad, "::/0"), bad).toBe(false);
    }
  });
});

describe("isCloudflareAddress", () => {
  it("recognises addresses inside every published range", () => {
    for (const range of CLOUDFLARE_IPV4_RANGES) {
      const base = range.split("/")[0]!;
      expect(isCloudflareAddress(base), range).toBe(true);
    }
    for (const range of CLOUDFLARE_IPV6_RANGES) {
      const base = range.split("/")[0]!;
      expect(isCloudflareAddress(`${base}1`), range).toBe(true);
    }
  });
  it("does not accuse documentation, private or provider addresses", () => {
    for (const ip of ["192.0.2.10", "10.0.0.1", "76.76.21.21", "8.8.8.8", "2001:db8::1", "2607:f8b0::1"]) {
      expect(isCloudflareAddress(ip), ip).toBe(false);
    }
  });
});

describe("isNonPublicAddress (the probe's SSRF pre-check)", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
    "1.2.3",
    "",
  ])("refuses %s", (ip) => {
    expect(isNonPublicAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "76.76.21.21", "172.32.0.1", "100.63.255.255", "2606:4700::1", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows %s",
    (ip) => {
      expect(isNonPublicAddress(ip)).toBe(false);
    },
  );
});
