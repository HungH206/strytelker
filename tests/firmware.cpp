// Host-side timing harness for the actual sketch; not a board/core compilation.
#include <cassert>
#include <cctype>
#include <deque>
#include <iostream>
#include <string>

constexpr int HIGH = 1, LOW = 0, INPUT = 0, OUTPUT = 1, INPUT_PULLUP = 2, A0 = 14;
unsigned long testTime = 0;
int buttonLevel = LOW;
unsigned long millis() { return testTime; }
void pinMode(int, int) {}
void digitalWrite(int, int) {}
int digitalRead(int) { return buttonLevel; }
int analogRead(int) { return 400; }
void tone(int, int) {}
void noTone(int) {}

class String {
 public:
  std::string value;
  String(const char* initial = "") : value(initial) {}
  String(std::string initial) : value(initial) {}
  void reserve(size_t count) { value.reserve(count); }
  size_t length() const { return value.length(); }
  void trim() {
    while (!value.empty() && std::isspace(value.front())) value.erase(value.begin());
    while (!value.empty() && std::isspace(value.back())) value.pop_back();
  }
  bool startsWith(const char* prefix) const { return value.rfind(prefix, 0) == 0; }
  bool endsWith(const char* suffix) const {
    const std::string ending(suffix);
    return value.size() >= ending.size() && value.compare(value.size() - ending.size(), ending.size(), ending) == 0;
  }
  String substring(size_t start, size_t end) const { return value.substr(start, end - start); }
  bool operator==(const char* other) const { return value == other; }
  String& operator+=(char character) { value += character; return *this; }
};
struct SerialMock {
  std::deque<char> input;
  std::string output;
  void begin(int) {}
  int available() { return input.size(); }
  char read() { char next = input.front(); input.pop_front(); return next; }
  explicit operator bool() const { return false; } // Disable unrelated SOUND output.
  void print(const char* text) { output += text; }
  void print(const String& text) { output += text.value; }
  void print(int value) { output += std::to_string(value); }
  void println() { output += '\n'; }
  void println(int value) { print(value); println(); }
  void feed(const std::string& text) { for (char character : text) input.push_back(character); }
} Serial;

#include "../sketch/sketch.ino"

void advance(unsigned long duration) {
  for (unsigned long elapsed = 0; elapsed < duration; elapsed++) { testTime++; loop(); }
}
void setButton(bool pressed) { buttonLevel = pressed ? HIGH : LOW; advance(60); }
void arm(bool navigation = true) {
  Serial.output.clear();
  Serial.feed(std::string("ARM 0123456789abcdef01234567") + (navigation ? " NAV\n" : "\n"));
  advance(60);
}
int main() {
  setup(); advance(60);
  arm(); setButton(true); setButton(false);
  assert(Serial.output.empty()); // A single press must wait for a possible double.
  advance(450);
  assert(Serial.output == "PRESS 0123456789abcdef01234567 1\n");

  arm(); setButton(true); setButton(false); setButton(true); setButton(false); advance(450);
  assert(Serial.output == "PRESS 0123456789abcdef01234567 2\n"); // No premature single.

  setButton(true); arm(); setButton(false); advance(450);
  assert(Serial.output.empty()); // A button held before arming must not count.
  setButton(true); setButton(false); advance(450);
  assert(Serial.output == "PRESS 0123456789abcdef01234567 1\n");

  arm(); buttonLevel = HIGH; advance(10); buttonLevel = LOW; advance(10);
  buttonLevel = HIGH; advance(10); buttonLevel = LOW; advance(500);
  assert(Serial.output.empty()); // Bounce alone does not generate a click.

  arm(); setButton(true); setButton(false); Serial.feed("DISARM\n"); advance(500);
  assert(Serial.output.empty());
  arm(); advance(31000); setButton(true); setButton(false); advance(450);
  assert(Serial.output.empty()); // Expired gestures are discarded.

  arm(false); setButton(true);
  assert(Serial.output == "PRESS 0123456789abcdef01234567\n");
  setButton(false); setButton(true); setButton(false);
  assert(Serial.output == "PRESS 0123456789abcdef01234567\n"); // Consume once.
  std::cout << "Firmware timing checks passed: single/double, held button, bounce, disarm, expiry, and one-shot confirmation.\n";
}
