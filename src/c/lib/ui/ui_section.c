#include "ui_section.h"
#include "ui_theme.h"
#include "ui_text.h"
#include "ui_fill.h"

#define SEC_BAND_H   24    // title band height
#define SEC_GAP       8    // blank space above a gapped section's title
#define SEC_LPAD      6
#define SEC_TEXT_DY   2    // nudge the title down: cap-box centering reads high here
#define SEC_CHIP_PADX 2    // horizontal padding of the white title chip around the text
#define SEC_CHIP_TOP  6    // chip's top offset within the title band
#define SEC_CHIP_H   14    // chip height — hugs the caption text, not the full band

int16_t ui_section_height(bool gap_above) {
  return gap_above ? SEC_BAND_H + SEC_GAP : SEC_BAND_H;
}

void ui_section_draw(GContext *g, GRect b, const char *title, bool gap_above) {
  if (!title || !title[0]) return;
  graphics_context_set_fill_color(g, ui_background());
  graphics_fill_rect(g, b, 0, GCornerNone);
  // The title sits below the inter-section gap on a light-gray band that runs the
  // full width; the gap above it stays the list background.
  int top = gap_above ? SEC_GAP : 0;
  GRect band = GRect(b.origin.x, b.origin.y + top, b.size.w, SEC_BAND_H);
  // The 64-color display has no gray between light-gray and white, so to get a
  // *lighter* band we dither light-gray over white into a paler tone.
  graphics_context_set_fill_color(g, ui_background());
  graphics_fill_rect(g, band, 0, GCornerNone);
  ui_fill_dither(g, band, ui_neutral());
  // A white rounded chip behind the title lifts it off the dithered band.
  GSize tz = graphics_text_layout_get_content_size(
      title, ui_font(UI_FONT_CAPTION_BOLD), band, GTextOverflowModeFill, GTextAlignmentLeft);
  GRect chip = GRect(band.origin.x + SEC_LPAD - SEC_CHIP_PADX,
                     band.origin.y + SEC_CHIP_TOP,
                     tz.w + 2 * SEC_CHIP_PADX, SEC_CHIP_H);
  graphics_context_set_fill_color(g, ui_background());
  graphics_fill_rect(g, chip, 3, GCornersAll);
  graphics_context_set_text_color(g, ui_text());
  ui_text_draw(g, title, UI_FONT_CAPTION_BOLD,
               GRect(band.origin.x + SEC_LPAD, band.origin.y + SEC_TEXT_DY,
                     band.size.w - 2 * SEC_LPAD, band.size.h),
               GTextAlignmentLeft, true, GTextOverflowModeFill);
}
