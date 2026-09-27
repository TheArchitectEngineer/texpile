// the one tinymist release Texpile installs itself, and which of its archives fits this machine
export const TINYMIST_VERSION = '0.15.8';

const RELEASE_URL = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}/`;

// the gnu builds link glibc 2.28 (tinymist builds them in a manylinux_2_28 container)
const GNU_MIN_GLIBC = [2, 28];

// Copied from the release's own `<archive>.sha256` files, which agree with its sha256.sum. Pinned
// here rather than fetched next to the archive: a checksum from the same place as the download
// only proves the two agree, not that the archive is the one this version of Texpile was tested
// with. A version bump replaces TINYMIST_VERSION and every line below together.
const SHA256_BY_TARGET: Record<string, string> = {
	'x86_64-pc-windows-msvc': 'b36c3e2926b2fe870e377b27aeebcb6265dd6a19fdca148a9a3ac4fdf57ee8a5',
	'aarch64-pc-windows-msvc': '9c9a48bc73a4ead1260c202ea0d590d16ffac1465ea9e1a4f0a1c1850638351f',
	'aarch64-apple-darwin': 'c3e8673fe4b7d8d21ad6d90e3c0684317191e1350758f7eaa02b5bde84339885',
	'x86_64-apple-darwin': '0ca702f40c5028d5937e081799a2c07d30c3f8f2ce3e40ce469471856cd6cef1',
	'x86_64-unknown-linux-gnu': '2428932e8d8b593ebc1ac4eed41fb9d3584166e1044bbcdef740b7296c348295',
	'x86_64-unknown-linux-musl': '816d33895ae343f934403dbd73f687a531368464450451510f3c108b0c04bcfd',
	'aarch64-unknown-linux-gnu': 'ec78300e89b34e0958b615b1d42c275fd11bf91d2d27401bbef07150e477f199',
	'aarch64-unknown-linux-musl': '8055377bfd463c05dc7e9cf4116d355ba0c2bb80a68a583b31905830f2d311eb'
};

export type Libc = 'gnu' | 'musl';

export type TinymistAsset = {
	/** the archive's file name in the release, e.g. tinymist-x86_64-unknown-linux-gnu.tar.gz */
	name: string;
	url: string;
	/** lowercase hex */
	sha256: string;
	format: 'zip' | 'tar.gz';
};

/** the release's name for this machine (a Rust target triple), or null when it publishes no build for it */
export function tinymistTarget(platform: NodeJS.Platform, arch: string, libc: Libc): string | null {
	const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
	if (!cpu) return null;
	if (platform === 'win32') return `${cpu}-pc-windows-msvc`;
	if (platform === 'darwin') return `${cpu}-apple-darwin`;
	if (platform === 'linux') return `${cpu}-unknown-linux-${libc}`;
	return null;
}

export function tinymistAssetFor(platform: NodeJS.Platform, arch: string, libc: Libc): TinymistAsset | null {
	const target = tinymistTarget(platform, arch, libc);
	const sha256 = target ? SHA256_BY_TARGET[target] : undefined;
	if (!target || !sha256) return null;
	const format = platform === 'win32' ? 'zip' : 'tar.gz';
	const name = `tinymist-${target}.${format}`;
	return { name, url: RELEASE_URL + name, sha256, format };
}

/**
 * Which Linux build runs here, from the glibc version the runtime reports (undefined off glibc).
 *
 * gnu wherever it can run: the musl build is static and runs anywhere, but tinymist brings no
 * allocator of its own, so on musl it compiles with musl's malloc, which is markedly slower.
 */
export function linuxLibc(glibcVersion: string | undefined): Libc {
	const parts = (glibcVersion ?? '').split('.').map(Number);
	if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return 'musl';
	const [major, minor] = parts;
	return major > GNU_MIN_GLIBC[0] || (major === GNU_MIN_GLIBC[0] && minor >= GNU_MIN_GLIBC[1]) ? 'gnu' : 'musl';
}
