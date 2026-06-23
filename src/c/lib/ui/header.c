#include "header.h"
#include "ui_theme.h"
#include "ui_text.h"

#define LPAD     6
#define RPAD     6
#define DIV_GAP  6      // breathing room between the title and the clock divider
#define TEXT_DY  1      // nudge text down: the font reads optically high in this short bar

struct Header {
  Layer  *layer;
  char    title[24];
  Header *next;          // intrusive list of live headers, for the minute tick
};

// Live headers, newest first. Menus stack, so several headers can be alive at
// once; the (context-less) minute tick walks the list and marks each dirty.
// Hidden headers sit under the top window and redraw cheaply.
static Header *s_headers;

static void header_update(Layer *layer, GContext *ctx) {
  Header *h = *(Header **)layer_get_data(layer);
  GRect b = layer_get_bounds(layer);

  // A hairline divider separates the header from the content below.
  graphics_context_set_stroke_color(ctx, ui_text_muted());
  graphics_draw_line(ctx, GPoint(b.origin.x, b.origin.y + b.size.h - 1),
                     GPoint(b.origin.x + b.size.w - 1, b.origin.y + b.size.h - 1));

  graphics_context_set_text_color(ctx, ui_text());

  // Right: the live clock. Then a black vertical divider, and the title fills
  // the space from the left edge to the divider.
  int title_right = b.origin.x + b.size.w - RPAD;
  char t[16]; clock_copy_time_string(t, sizeof t);
  GSize tz = graphics_text_layout_get_content_size(t, ui_font(UI_FONT_BODY_BOLD),
                 GRect(0, 0, b.size.w, b.size.h), GTextOverflowModeFill, GTextAlignmentLeft);
  int clock_x = b.origin.x + b.size.w - RPAD - tz.w;
  ui_text_draw(ctx, t, UI_FONT_BODY_BOLD,
               GRect(clock_x, b.origin.y + TEXT_DY, tz.w, b.size.h),
               GTextAlignmentLeft, true, GTextOverflowModeFill);
  int div_x = clock_x - DIV_GAP;
  graphics_context_set_stroke_color(ctx, ui_text());   // black divider
  graphics_draw_line(ctx, GPoint(div_x, b.origin.y + 4),
                     GPoint(div_x, b.origin.y + b.size.h - 5));
  title_right = div_x - DIV_GAP;

  if (h->title[0]) {
    int text_left = b.origin.x + LPAD;
    ui_text_draw(ctx, h->title, UI_FONT_BODY_BOLD,
                 GRect(text_left, b.origin.y + TEXT_DY, title_right - text_left, b.size.h),
                 GTextAlignmentLeft, true, GTextOverflowModeTrailingEllipsis);
  }
}

static void header_tick(struct tm *t, TimeUnits units) {
  for (Header *h = s_headers; h; h = h->next) layer_mark_dirty(h->layer);
}

Header *header_create(Layer *parent, const char *title) {
  Header *h = malloc(sizeof(Header));
  if (!h) return NULL;
  strncpy(h->title, title ? title : "", sizeof(h->title) - 1);
  h->title[sizeof(h->title) - 1] = '\0';
  GRect pb = layer_get_bounds(parent);
  h->layer = layer_create_with_data(
      GRect(pb.origin.x, pb.origin.y, pb.size.w, HEADER_H), sizeof(Header *));
  *(Header **)layer_get_data(h->layer) = h;
  layer_set_update_proc(h->layer, header_update);
  layer_add_child(parent, h->layer);

  if (!s_headers) tick_timer_service_subscribe(MINUTE_UNIT, header_tick);
  h->next = s_headers;
  s_headers = h;
  return h;
}

void header_set_title(Header *h, const char *title) {
  if (!h) return;
  strncpy(h->title, title ? title : "", sizeof(h->title) - 1);
  h->title[sizeof(h->title) - 1] = '\0';
  layer_mark_dirty(h->layer);
}

void header_destroy(Header *h) {
  if (!h) return;
  // Unlink from the live list; unsubscribe the tick once the last one is gone.
  for (Header **pp = &s_headers; *pp; pp = &(*pp)->next) {
    if (*pp == h) { *pp = h->next; break; }
  }
  if (!s_headers) tick_timer_service_unsubscribe();
  layer_destroy(h->layer);
  free(h);
}
