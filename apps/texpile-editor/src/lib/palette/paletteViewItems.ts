import { Columns2, Eye, GitCompare, PanelLeft, Search } from '@lucide/svelte';
import { combo } from '$lib/chrome/shortcutText';
import { COLOR_VISION_MODES, colorVision, colorVisionLabel } from '$lib/preview/colorVision/colorVision';
import type { PaletteActions } from '$lib/workspace/commandPalette.svelte';
import type { PaletteItem } from './paletteCommands';
import { m } from '$lib/paraglide/messages';

export function viewItems(a: PaletteActions): PaletteItem[] {
	const items: PaletteItem[] = [];
	const group = m.palette_group_view();
	const mode = a.getViewMode();
	if (a.hasFile()) {
		if (mode !== 'visual')
			items.push({
				id: 'view.visual',
				label: m.palette_show_visual(),
				group,
				keywords: 'wysiwyg rendered preview mode',
				icon: Eye,
				run: () => a.setViewMode('visual')
			});
		if (mode !== 'source')
			items.push({
				id: 'view.source',
				label: m.palette_show_source(),
				group,
				keywords: 'latex code raw mode',
				icon: Columns2,
				run: () => a.setViewMode('source')
			});
		if (mode !== 'diff' && a.canGit())
			items.push({
				id: 'view.diff',
				label: m.palette_show_diff(),
				group,
				keywords: 'git changes compare commit',
				icon: GitCompare,
				run: () => a.setViewMode('diff')
			});
	}
	if (a.hasSidebar())
		items.push({
			id: 'view.sidebar',
			label: a.sidebarOpen() ? m.palette_hide_sidebar() : m.palette_show_sidebar(),
			group,
			keywords: 'explorer files panel',
			icon: PanelLeft,
			run: () => a.toggleSidebar()
		});
	// the previews' color vision check. The simulations are found by typing (color, blind, protan...)
	// rather than listed, four rows of one feature in the browse list; the way back is listed while on
	for (const mode of COLOR_VISION_MODES) {
		if (mode === colorVision.current) continue;
		items.push({
			id: `view.colorVision.${mode}`,
			label: mode === 'none' ? m.color_vision_off() : m.color_vision_palette({ mode: colorVisionLabel(mode) }),
			group,
			keywords: 'color colour vision blind blindness deficiency accessibility simulate preview',
			icon: Eye,
			searchOnly: mode !== 'none',
			run: () => {
				colorVision.current = mode;
			}
		});
	}
	if (a.canSearch())
		items.push({
			id: 'view.findInFiles',
			label: m.wsview_find_in_files(),
			group,
			keywords: 'grep search project',
			hint: combo('F', { shift: true }),
			icon: Search,
			run: () => a.openGlobalSearch()
		});
	return items;
}
