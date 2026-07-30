/**
 * The widget's identity, which three places must agree on: the plugin config in
 * app.json, the name guard in the task handler, and `requestWidgetUpdate`.
 * A mismatch fails silently — the widget simply never updates — so it is one
 * constant rather than three string literals.
 */
export const WIDGET_NAME = 'NextReminder';
