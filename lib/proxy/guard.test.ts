import { describe, expect, it } from "vitest";
import { ProxyError } from "./errors";
import { isBlockedIp, resolvePublicHost, validateUrl, type LookupFn } from "./guard";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProxyError) return e.code;
    throw e;
  }
  return "none";
}

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local and special IPv4 and IPv6 literals, including mapped forms", () => {
    const blocked = [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1",
      "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "240.0.0.1",
      "255.255.255.255", "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::127.0.0.1",
      "64:ff9b::a00:1", "2002:7f00:1::1", "[::1]",
    ];
    for (const ip of blocked) expect(isBlockedIp(ip), ip).toBe(true);
    const open = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.255.255", "198.20.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
    for (const ip of open) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it("rejects bad schemes, credentials, odd ports and local host names; normalises IP tricks", () => {
    expect(codeOf(() => validateUrl("ftp://example.com/"))).toBe("bad-url");
    expect(codeOf(() => validateUrl("file:///etc/passwd"))).toBe("bad-url");
    expect(codeOf(() => validateUrl("javascript:alert(1)"))).toBe("bad-url");
    expect(codeOf(() => validateUrl("not a url"))).toBe("bad-url");
    expect(codeOf(() => validateUrl("https://user:pw@example.com/"))).toBe("bad-url");
    expect(codeOf(() => validateUrl("http://example.com:8080/"))).toBe("blocked-host");
    expect(codeOf(() => validateUrl("https://example.com:22/"))).toBe("blocked-host");
    for (const host of ["localhost", "app.localhost", "printer.local", "db.internal", "intranet", "LOCALHOST."]) {
      expect(codeOf(() => validateUrl(`http://${host}/`)), host).toBe("blocked-host");
    }
    // Decimal, hex, octal and short IPv4 spellings all normalise to 127.0.0.1 and are caught.
    for (const host of ["2130706433", "0x7f.0.0.1", "0177.0.0.1", "127.1", "[::ffff:127.0.0.1]", "169.254.169.254"]) {
      expect(codeOf(() => validateUrl(`http://${host}/`)), host).toBe("blocked-host");
    }
    expect(codeOf(() => validateUrl("https://www.usa.gov:443/food-assistance#top"))).toBe("none");
    expect(validateUrl("https://www.usa.gov/a#frag").href).toBe("https://www.usa.gov/a");
  });

  it("passes a public host and blocks one whose DNS has any private record", async () => {
    const publicLookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const mixedLookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    const metadataLookup: LookupFn = async () => [{ address: "::ffff:a9fe:a9fe", family: 6 }];
    const url = validateUrl("https://example.com/");
    expect(await resolvePublicHost(url, publicLookup)).toEqual([{ address: "93.184.216.34", family: 4 }]);
    await expect(resolvePublicHost(url, mixedLookup)).rejects.toMatchObject({ code: "blocked-host" });
    await expect(resolvePublicHost(url, metadataLookup)).rejects.toMatchObject({ code: "blocked-host" });
    await expect(resolvePublicHost(url, async () => Promise.reject(new Error("ENOTFOUND")))).rejects.toMatchObject({
      code: "fetch-failed",
    });
  });
});
