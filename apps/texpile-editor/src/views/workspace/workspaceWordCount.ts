// The detailed word count, for the document the open file belongs to: counted from the main file
// when that reads the open one, else from the open file on its own (a file the main one does not
// bring in is a document of its own as far as its reader is concerned).
import { countProjectWords, counts, type ProjectWords } from '$lib/workspace/wordCount/projectWords';
import { dirname, samePath } from '$lib/workspace/fileSystem';
import { mainFile, workspaceRoot } from '$lib/workspace/workspaceStore';
import type { DocumentBuffer } from '$lib/workspace/documentBuffer.svelte';
import type { WorkspaceProvider } from '$lib/workspace/workspaceProvider';

export async function countDocumentWords(doc: DocumentBuffer, provider: WorkspaceProvider): Promise<ProjectWords | null> {
	if (!doc.path) return null;
	const open: string = doc.path;
	const root = workspaceRoot.current ?? dirname(open);
	// the open file as its editor has it, unsaved edits and all
	function read(p: string): Promise<string> {
		return samePath(p, open) ? Promise.resolve(doc.buffer) : provider.readText(p);
	}
	const main = mainFile.current;
	if (main && !samePath(main, open) && /\.typ$/i.test(main) === /\.typ$/i.test(open)) {
		try {
			const whole = await countProjectWords(main, root, read);
			if (counts(whole, open)) return whole;
		} catch {
			/* the main file cannot be read: count the open one */
		}
	}
	return countProjectWords(open, root, read);
}
