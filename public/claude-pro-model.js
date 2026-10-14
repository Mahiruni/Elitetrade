// web/claude-pro/model.ts
var DURATIONS = [3, 5, 15, 60, 180, 300, 1800, 3600];
var PRESETS = {
  sonnet: { name: "Quick Scan", subtitle: "Display preset" },
  opus: { name: "Structure", subtitle: "Display preset" },
  fable: { name: "POI Deep", subtitle: "Display preset" }
};
var ASSETS = [
  ["EUR/GBP OTC", "Euro / British Pound", "\u{1F1EA}\u{1F1FA}", "\u{1F1EC}\u{1F1E7}"],
  ["EUR/USD OTC", "Euro / US Dollar", "\u{1F1EA}\u{1F1FA}", "\u{1F1FA}\u{1F1F8}"],
  ["USD/JPY OTC", "US Dollar / Japanese Yen", "\u{1F1FA}\u{1F1F8}", "\u{1F1EF}\u{1F1F5}"],
  ["AUD/USD OTC", "Australian Dollar / US Dollar", "\u{1F1E6}\u{1F1FA}", "\u{1F1FA}\u{1F1F8}"],
  ["USD/CHF OTC", "US Dollar / Swiss Franc", "\u{1F1FA}\u{1F1F8}", "\u{1F1E8}\u{1F1ED}"],
  ["GBP/USD OTC", "British Pound / US Dollar", "\u{1F1EC}\u{1F1E7}", "\u{1F1FA}\u{1F1F8}"],
  ["EUR/JPY OTC", "Euro / Japanese Yen", "\u{1F1EA}\u{1F1FA}", "\u{1F1EF}\u{1F1F5}"],
  ["AUD/JPY OTC", "Australian Dollar / Japanese Yen", "\u{1F1E6}\u{1F1FA}", "\u{1F1EF}\u{1F1F5}"],
  ["GBP/JPY OTC", "British Pound / Japanese Yen", "\u{1F1EC}\u{1F1E7}", "\u{1F1EF}\u{1F1F5}"],
  ["EUR/CHF OTC", "Euro / Swiss Franc", "\u{1F1EA}\u{1F1FA}", "\u{1F1E8}\u{1F1ED}"],
  ["USD/CAD OTC", "US Dollar / Canadian Dollar", "\u{1F1FA}\u{1F1F8}", "\u{1F1E8}\u{1F1E6}"],
  ["NZD/USD OTC", "New Zealand Dollar / US Dollar", "\u{1F1F3}\u{1F1FF}", "\u{1F1FA}\u{1F1F8}"],
  ["Apple", "Apple \xB7 sample stock", "A", ""],
  ["Tesla", "Tesla \xB7 sample stock", "T", ""],
  ["NVIDIA", ¶»§q«^