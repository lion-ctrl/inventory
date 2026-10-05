// @vitest-environment node
// Contract between the CSP source (src/security/csp.ts) and its delivery copies:
// the hand-maintained Content-Security-Policy header in vercel.json, the build
// config and the <meta> the build emits. The two copies drifted once (img-src lost
// the photo origins and product thumbnails went blank in production); this suite
// makes any drift fail `pnpm test:run`.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  buildCspMeta,
  CONVEX_CLOUD_ORIGIN,
  CSP_DIRECTIVES,
  CSP_HEADER_ONLY_DIRECTIVES,
  parseCsp,
  serializeCsp,
} from '@/security/csp';

type Policy = Map<string, string[]>;
type VercelConfig = {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

function vercelHeaderPolicy(): string {
  const { headers } = JSON.parse(read('../../vercel.json')) as VercelConfig;
  const header = headers
    .find((rule) => rule.source === '/(.*)')
    ?.headers.find((h) => h.key === 'Content-Security-Policy');
  if (!header) {
    throw new Error('vercel.json: no Content-Security-Policy header for /(.*)');
  }
  return header.value;
}

const sameSources = (a: readonly string[], b: readonly string[]) =>
  new Set(a).size === new Set(b).size && a.every((v) => b.includes(v));

/** Directive names on which the header disagrees with the source, both ways. */
function diffCsp(source: Policy, header: Policy): string[] {
  const expected: Policy = new Map(source);
  for (const [name, sources] of CSP_HEADER_ONLY_DIRECTIVES) {
    expected.set(name, [...sources]);
  }
  const names = new Set([...expected.keys(), ...header.keys()]);
  return [...names].filter((name) => {
    const want = expected.get(name);
    const got = header.get(name);
    return !want || !got || !sameSources(want, got);
  });
}

/** Copy of `policy` with `name` set to `sources`, or removed when null. */
function doctored(policy: Policy, name: string, sources: string[] | null) {
  const copy: Policy = new Map(policy);
  if (sources === null) copy.delete(name);
  else copy.set(name, sources);
  return copy;
}

const source: Policy = new Map(
  CSP_DIRECTIVES.map(([name, sources]) => [name, [...sources]])
);
const header = parseCsp(vercelHeaderPolicy());
const cdn = 'https://cdn.example.com';
const withCdn = (policy: Policy, name: string) =>
  doctored(policy, name, [...(policy.get(name) ?? []), cdn]);

describe('serializeCsp() / parseCsp()', () => {
  test('round-trip: parsing the serialized source gives back every directive', () => {
    expect([...parseCsp(serializeCsp(CSP_DIRECTIVES))]).toEqual([...source]);
  });
});

describe('vercel.json header ⇄ source parity', () => {
  test('the shipped header agrees with the source on every directive', () => {
    expect(diffCsp(source, header)).toEqual([]);
  });

  test('the header names are exactly the source names plus the header-only ones', () => {
    const expected = [...CSP_DIRECTIVES, ...CSP_HEADER_ONLY_DIRECTIVES].map(
      ([name]) => name
    );
    expect([...header.keys()].sort()).toEqual(expected.sort());
  });

  test("frame-ancestors 'none' is the only header-only directive and is required", () => {
    expect(CSP_HEADER_ONLY_DIRECTIVES).toEqual([
      ['frame-ancestors', ["'none'"]],
    ]);
    expect(source.has('frame-ancestors')).toBe(false);
    expect(header.get('frame-ancestors')).toEqual(["'none'"]);
  });

  // Doctored copies, one per spec scenario: a value only in the header, a value
  // only in the source, a header lacking frame-ancestors 'none', a header-only
  // media-src, a header lacking worker-src. Each must name exactly its directive.
  test.each<[string, Policy, Policy]>([
    ['img-src', source, withCdn(header, 'img-src')],
    ['connect-src', withCdn(source, 'connect-src'), header],
    ['frame-ancestors', source, doctored(header, 'frame-ancestors', null)],
    ['media-src', source, doctored(header, 'media-src', ["'self'"])],
    ['worker-src', source, doctored(header, 'worker-src', null)],
  ])('%s drift fails, naming it', (name, src, hdr) => {
    expect(diffCsp(src, hdr)).toEqual([name]);
  });
});

describe('img-src admits every origin the app renders', () => {
  const required = ["'self'", 'data:', 'blob:', CONVEX_CLOUD_ORIGIN];

  test('CONVEX_CLOUD_ORIGIN is the storage host connect-src already trusts', () => {
    expect(CONVEX_CLOUD_ORIGIN).toBe('https://*.convex.cloud');
    expect(source.get('connect-src')).toContain(CONVEX_CLOUD_ORIGIN);
  });

  test.each<[string, string[] | undefined]>([
    ['the source', source.get('img-src')],
    ['the vercel.json header', header.get('img-src')],
  ])('%s admits the preview and the storage origin only', (_where, imgSrc) => {
    for (const origin of required) expect(imgSrc).toContain(origin);
    expect(imgSrc).not.toContain('*');
    expect(imgSrc).not.toContain('https:');
  });
});

describe('buildCspMeta()', () => {
  test('wraps the serialized source as the head-prepended http-equiv meta', () => {
    const meta = buildCspMeta();
    expect(meta.tag).toBe('meta');
    expect(meta.attrs['http-equiv']).toBe('Content-Security-Policy');
    expect(meta.attrs.content).toBe(serializeCsp(CSP_DIRECTIVES));
    expect(meta.injectTo).toBe('head-prepend');
  });
});

describe('vite.config.ts carries no hand-typed directive', () => {
  const config = read('../../vite.config.ts');
  const names = new Set([
    ...[...CSP_DIRECTIVES, ...CSP_HEADER_ONLY_DIRECTIVES].map(([name]) => name),
    'base-uri',
    'form-action',
    'frame-ancestors',
    'report-to',
    'report-uri',
    'upgrade-insecure-requests',
  ]);

  test.each([...names])('does not mention %s', (name) => {
    expect(config).not.toContain(name);
  });

  test('mentions no *-src directive and consumes the module instead', () => {
    expect(config).not.toMatch(/\b[a-z]+(?:-[a-z]+)*-src\b/);
    expect(config).toContain('[buildCspMeta()]');
  });
});

// Vite escapes attribute values (' → &#39;), so decode before comparing.
const decodeAttr = (value: string) =>
  value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const META = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/;

describe.runIf(process.env.CSP_CHECK_DIST === '1')('dist/index.html', () => {
  test('after `pnpm build`, the built <meta> is the serialized source', () => {
    const match = META.exec(read('../../dist/index.html'));
    if (!match) throw new Error('dist/index.html: no CSP <meta>');
    expect(decodeAttr(match[1])).toBe(serializeCsp(CSP_DIRECTIVES));
  });
});
