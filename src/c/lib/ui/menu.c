#include "menu.h"
#include "list_core.h"

Menu *menu_push(const char *title, MenuConfig cfg) {
  return list_core_push(title, (ListCoreConfig) {
    .ctx = cfg.ctx,
    .size = cfg.size,
    .interactive = true,
    .get_count = cfg.get_count,
    .get_item = cfg.get_item,
    .on_select = cfg.on_select,
    .on_unload = cfg.on_unload,
    .get_sections = cfg.get_sections,
    .get_section_count = cfg.get_section_count,
    .section_title = cfg.section_title,
  });
}
void    menu_reload(Menu *m) { list_core_reload(m); }
Window *menu_window(Menu *m) { return list_core_window(m); }
void    menu_set_header_enabled(bool e) { list_core_set_header_enabled(e); }
bool    menu_header_enabled(void) { return list_core_header_enabled(); }
