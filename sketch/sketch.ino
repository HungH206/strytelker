// Grove Base Shield: sound A0, button D2, active buzzer D5.
// UNO Q: use a current Zephyr core where Serial aliases Monitor.
const int SOUND_PIN = A0;
const int BUTTON_PIN = 2;
const int BUZZER_PIN = 5;

// Confirmed Grove button module and active buzzer configuration.
// Set LOW for an active-low button; set false for a passive piezo buzzer.
const int BUTTON_PRESSED_LEVEL = HIGH;
const bool ACTIVE_BUZZER = true;
const unsigned long DEBOUNCE_MS = 40;
const unsigned long ARM_TIMEOUT_MS = 30000;
const unsigned long SOUND_INTERVAL_MS = 250;
const unsigned long DOUBLE_PRESS_MS = 400;

String command;
String nonce;
bool lastPressed = false;
bool stablePressed = false;
bool releasedSinceArm = false;
bool buzzing = false;
bool navigationMode = false;
bool pressedAfterArm = false;
int pressCount = 0;
unsigned long releasedAt = 0;
unsigned long changedAt = 0;
unsigned long armedAt = 0;
unsigned long buzzerStartedAt = 0;
unsigned long buzzerDuration = 0;
unsigned long soundSampledAt = 0;

void beep(unsigned long duration) {
  if (ACTIVE_BUZZER) digitalWrite(BUZZER_PIN, HIGH);
  else tone(BUZZER_PIN, 2000);
  buzzing = true;
  buzzerStartedAt = millis();
  buzzerDuration = duration;
}

void readCommands() {
  while (Serial.available()) {
    char character = Serial.read();
    if (character == '\n') {
      command.trim();
      if (command.startsWith("ARM ") && (command.length() == 28 || (command.length() == 32 && command.endsWith(" NAV")))) {
        nonce = command.substring(4, 28);
        navigationMode = command.endsWith(" NAV");
        pressCount = 0;
        pressedAfterArm = false;
        armedAt = millis();
        releasedSinceArm = false;
        beep(60); // Ready for a fresh release-and-press.
      }
      if (command == "DISARM") { nonce = ""; pressCount = 0; pressedAfterArm = false; }
      command = "";
    } else if (command.length() < 64) {
      command += character;
    } else {
      command = "";
    }
  }
}

void sendPress(int count) {
  Serial.print("PRESS ");
  Serial.print(nonce);
  if (navigationMode) { Serial.print(" "); Serial.print(count); }
  Serial.println();
  nonce = ""; // Exactly one gesture per server arm.
  pressCount = 0;
  beep(140); // Gesture sent, not a server acceptance or purchase approval.
}

void updateButton() {
  bool pressed = digitalRead(BUTTON_PIN) == BUTTON_PRESSED_LEVEL;
  if (pressed != lastPressed) changedAt = millis();
  lastPressed = pressed;
  if (millis() - changedAt < DEBOUNCE_MS) return;
  if (!pressed && nonce.length()) releasedSinceArm = true;
  if (pressed != stablePressed) {
    stablePressed = pressed;
    if (nonce.length() && releasedSinceArm) {
      if (!navigationMode && pressed) sendPress(1);
      else if (navigationMode && pressed) pressedAfterArm = true;
      else if (navigationMode && !pressed && pressedAfterArm) {
        pressedAfterArm = false;
        pressCount++;
        releasedAt = millis();
        if (pressCount >= 2) sendPress(2);
      }
    }
  }
  // Wait for the double-press window before dispatching a single press.
  // Do not dispatch while a second press is in progress.
  if (navigationMode && nonce.length() && pressCount == 1 && !pressed && millis() - releasedAt >= DOUBLE_PRESS_MS) sendPress(1);
}

void setup() {
  pinMode(SOUND_PIN, INPUT);
  pinMode(BUTTON_PIN, BUTTON_PRESSED_LEVEL == LOW ? INPUT_PULLUP : INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.begin(9600);
  command.reserve(64);
  nonce.reserve(24);
}

void loop() {
  readCommands();
  if (nonce.length() && millis() - armedAt >= ARM_TIMEOUT_MS) { nonce = ""; pressCount = 0; }
  updateButton();

  if (buzzing && millis() - buzzerStartedAt >= buzzerDuration) {
    if (!ACTIVE_BUZZER) noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
    buzzing = false;
  }

  if (Serial && millis() - soundSampledAt >= SOUND_INTERVAL_MS) {
    soundSampledAt = millis();
    Serial.print("SOUND ");
    Serial.println(analogRead(SOUND_PIN)); // Raw ADC sample, not audio or dB.
  }
}
