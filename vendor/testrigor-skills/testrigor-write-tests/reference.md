# testRigor Plain-English Command Reference

The complete command catalog. Commands are case-insensitive and tolerant of phrasing, but the keywords below are the documented, most-reliable forms. Anything in `"quotes"` is what the end user sees or types.

**How to read this file:**

- **One command per line.** Each line in a code block is a *separate* step — a complete command on its own.
- **`//` starts a comment**, not part of the command. It explains the step or, where two similar commands exist, says when to pick which.
- **A `/` between words lists alternatives, not one step.** `scroll down / up / left / right` means four separate commands (`scroll down`, `scroll up`, `scroll left`, `scroll right`) — use whichever direction you need; don't paste the line verbatim.

> Official language docs: https://testrigor.com/docs/language/

---

## Navigation & tabs

```
open url "https://example.com"
grab url and save it as "currentUrl"
go back
go forward
reload
reset to home
open new tab
switch to tab 3
switch to tab "popup"
close tab
click "Open report" and switch to the new tab
```

## Clicks & interaction

```
click "element"
click on the 3rd "element"
click "element" or "alternative"
double click on the 2nd "row"
triple click on "paragraph"
right click on "file"
middle click on "link"
long click on "tile"
long click on "tile" by 5 sec

click "element" using AI            // last resort: caption is fuzzy / purely visual
click "element" using OCR           // text is baked into an image/canvas (not real DOM text)
click "element" using javascript    // force a JS click when a normal click won't register
click "element" using the mouse     // simulate a real mouse click (hover effects, etc.)
click "element" without scrolling   // don't auto-scroll the element into view first
click "element" considering overlapped elements
click "element" with retries if the next step fails
click in the middle of the screen
click on image from stored value "Logo"

press home / click home             // mobile
press recent / click recent         // mobile
```

## Text input

```
enter "text" into "field"
enter stored value "variable" into "field"
select "option" from "dropdown"
select 1st option from "dropdown"

click on "field"
type "free text"                    // types into focused element

enter enter into "field"            // special keys: enter, tab, escape
type arrow right
```

Multi-line input:

```
enter text starting from next line and ending with [END]
line1
line2[END] into "Comments"
```

## Generating data

```
generate unique email, then enter into "Email" and save as "newEmail"
generate unique name, then enter into "Name" and save as "generatedName"
generate from template "###-###-####", then enter into "Phone" and save as "phone"
generate from regex "[a-z]{10,18}", then enter into "Notes" and save as "notes"
generate from regex "[A-Z][a-z]{30}", and save as "generatedName"

generate google code from stored value "qr-code-image" and save it as "code"  // 2FA
generate totp code using "MYSECRETKEY" and save it as "code"
```

## Assertions & validations

Page content:

```
check that page contains "text"
check that page contains stored value from "variable"   // compares against a saved value
check that page contains "text" using OCR               // only when the text is inside an image/canvas
check that page doesn't contain 4th button              // negative check
check that page didn't change
check that page didn't change compared to the previous step
```

Elements:

```
check that "element" contains "text"
check that "element" contains stored value from "variable"
check that button "Add to Cart" is disabled
check that button "Add to Cart" is enabled
check that "spinner" is changing
check that "spinner" is not changing
```

AI / vision validation (use for visual or judgement-based checks):

```
check that page "contains a positive message" using ai
check that "banner" "contains a discount offer" using ai
check that statement is true "page contains the company logo"
check page for UI errors
check page for UI errors reporting major errors or higher
```

Image / screen comparison:

```
compare image of "chart" to previous version with allowance of "5%"
compare screen to previous version
compare screen to previous version with allowance of "5%"
compare screen to stored value "Saved Screenshot"
compare inputs
compare texts
compare buttons
```

Downloaded files:

```
check that file "instruction.pdf" was downloaded
check that downloaded file contains "text"
check that file "agreement.pdf" does not contain "liability"
check that file was downloaded and save it as "DownloadedFiles"
check that file was downloaded and save text as "fileText"
```

Stored values:

```
check that stored value "variable" itself contains "text"
```

## Mouse, scroll & gestures

```
hover over "element"
hover over "element" using AI

drag "card" to "Done column"
drag "card" to "Done column" using AI
drag file "https://.../a.png" onto "Dropzone"
drag file from saved value "File" onto "Dropzone"
drag "canvas" with offset "0,0" to "canvas" with offset "50,50"

scroll down / up / left / right     // four separate commands — pick one direction
scroll down on "list"               // scroll inside a specific element, not the page
scroll down by 1/2 of the screen
scroll down until page contains "Footer"    // prefer this over a blind scroll + wait
scroll down to the bottom of the page
scroll up to the top of the page
scroll down on "text" using the mouse until page contains "Sign here!"

swipe right / left / down / up      // mobile
swipe down on "carousel"
zoom in / zoom out                  // mobile
zoom in "20" % from the middle of the screen
pinch open "20" % from the middle of the screen
pinch close "10" % from "map"
long press on the 3rd "thumbnail"
```

## Waits & timing

```
wait 3 seconds                      // maximum 2 minutes
```

Prefer `scroll ... until page contains` or `click ... if exists` over fixed waits; testRigor auto-waits for elements, so explicit waits are rarely needed.

## Keyboard modifiers

```
hold key command and click "button"
hold key shift and click "row"
hold key command
click "item1"
release key command
```

Supported keys: Control, Shift, Alt, Command, F1–F12, Enter, Space, Delete, Backspace.

## Variables & storage

```
save value "text" as "name"
// ${var} interpolates ONLY inside `string with parameters` (and `save expression`) — never a bare "string"
save string with parameters "${base}/path" as "fullPath"
save expression "${a} + ${b}" as "answer"
enter from the string with parameters "${homePrefix}/checkout" into "URL"   // interpolate into an action
check that page contains string with parameters "Welcome, ${firstName}"     // interpolate into an assertion

grab value from "Total" and save it as "orderTotal"
grab value of "\d{3}-\d{4}" and save it as "extracted"        // regex
grab value of "\d+" from "Badge" and save it as "count"
grab value by template "(###) ###-####" and save it as "phone"
grab value of attribute "href" from "Profile link" and save it as "url"
grab value of css property "width" from "Bar" and save it as "barWidth"
grab value by description "10-digit phone" using AI and save it as "phone"
grab values from table "Orders" at first column and save it as "ids"
grab url and save it as "currentUrl"

extract value by regex "\d+" from stored value "raw" and save it as "num"
extract value by template "######" from stored value "raw" and save it as "zip"

copy selection to clipboard
copy to clipboard value "text"
copy to clipboard from "name"
paste from clipboard
store clipboard value as "clip"
```

## Reusable rules

Built-in rules (call by name):

```
login
logout
sign up
sign up with email confirmation
login with email OTP
purchase "Wireless Mouse"
search for "monitor"
fill out form
pick "06/02/2026" from "Start date"
pick dates from "06/01/2026" to "06/10/2026"
```

Salesforce-specific built-ins:

```
navigate to "Accounts" using app launcher
ensure we are on the "Contacts" page
create new "Opportunity"
open list actions for "Leads"
edit list item "Acme"
delete list item "Acme"
change owner of list item "Acme"
search for "Acme" of type "Account" and open
verify that object containing "Acme" exists
pick "High" from "Priority" in Salesforce
search and pick "Acme" from "Account Name" in Salesforce
```

Custom rule (define in the suite's *Reusable Rules*; the quoted words are parameters):

```
Rule:  search "product" click on the link and then press "button"
Steps: enter stored value "product" into "search"
       click link stored value "product"
       click stored value "button"

Use:   search "Computer" click on the link and then press "Add to Cart"
```

## Email testing

```
send email to "qa@test.com" with subject "Test" and body "Message"
send email from "a@test.com" to "b@test.com" with subject "Test", body "Hi", and attachment from saved value "File"
send email with attachment "https://.../file.pdf" with filename "renamed.pdf"

check that email from "no-reply@app.com" is delivered
check that email to "qa@test.com" was received
check that email to "qa@test.com" and "Confirm" in subject was received
check that two emails to "qa@test.com" were delivered
check that email to "qa@test.com" and attachment "report.pdf" contains "Total"

reply to email from "support@app.com" with "confirmed"
open email attachment "report.pdf"
open email attachment from stored value "attachmentFile"
```

## SMS & phone

```
sms to +15344297154 with body "hello"
message +15344297154 with body "hi" and verify it was delivered
check that sms to "+12345678902" matches regex "Code\:\d\d\d\d" and save as "otp"
call "+15344297154"
call "+15344297154" and check it was picked up
```

## File operations

```
download file "https://example.com/file.txt"
download file "ftp://user:pass@example.com/file.txt"
download file "ftp://example.com/f.txt" using username "user" and password from stored value "ftpPass"

upload file from stored value "file.txt" to "sftp://example.com/file.txt" using username "user" and password from stored value "pass"
upload file from template stored value "template.json" to "sftp://example.com/default.json"
upload file "https://example.com/avatar.jpeg" to device
```

## Forms

```
fill out form                       // every field
fill out required fields in form    // only the required ones
fill out the rest of the form       // "the rest of" = leave fields you already filled, do the others
fill out the rest of the required fields in form
fill out form "Billing"             // scope to a named form/section
fill out form identified by field "First name"   // scope by a field the form contains
fill out form with generated values // synthesize realistic values
fill out required fields in form with sample values
fill out form using ai for unrecognized fields   // let AI handle fields it can't map
fill out form and skip unrecognized fields        // ...or just skip them instead

fill out all fields
fill out all required fields
fill out all empty fields
fill out all empty and required fields
fill out all fields with generated values
fill out all required fields using ai for unrecognized fields
```

## Multi-browser / multi-device

```
start browser "User 2"
start browser "User 2" and switch
start device "User 2"
switch to browser "User 2"
switch to device "User 2"
switch to browser "default"
switch context to native
switch context to browser
```

## Mobile-specific

```
change device orientation to landscape
change device orientation to portrait

enable touch ID / enable face ID / disable touch ID / disable face ID
scan using touch ID and pass
scan using face ID and fail

restart app
install application "whatsapp"

open deeplink "myapp://path"
open deeplink "geo:0,0?q=eiffel+tower" with package "com.google.maps"

set camera image to "https://.../qr.png"
set camera image to stored value "qr-code"
set geo location "40.7128,-74.0060"
```

## Advanced

```
execute JavaScript in the browser text starting from next line and ending with [END]
document.querySelector("#input1").value = "John Doe";
[END]

accept prompt with value "John Doe"
crawl sitemap "https://example.com/sitemap.xml"
take screenshot
```

API testing (`call api`, `mock api`) — see [api-testing.md](api-testing.md).

---

## Element reference grammar

Element types:

```
text "x"   label "x"   button "x"   link "x"   input "x"
dropdown "x"   checkbox "x"   radiobutton "x"   file input "x"
```

Index / ordinal:

```
1st "x"   2nd "x"   3rd "x"   second "x"
```

Stored value as the target:

```
click stored value "buttonName"
```

Relative position (anchor by nearby visible text):

```
"Edit" below "Invoice #42"
"Price" above "Add to Cart"
"Qty" to the left of "Wireless Mouse"
"Remove" to the right of "Wireless Mouse"
"Email" near "Subscribe"
```

Context / scope:

```
"Save" in the context of "Billing"
"Delete" below "Acme" in the context of "Customers"
```

Case & exactness:

```
exactly "Save"
case sensitive "Save"
strictly button "Delete"
```

Pattern matching:

```
contains regex "\d{3}-\d{4}"
contains template "###-###-####"
matches regex "^[A-Z].*"
matches template "######"
```

Multiple / conditional:

```
click "Checkout" or "Submit"
click "Checkout" or "Submit" if exists
click "Cookie banner" if exists
```

---

## Pre-defined variables

System: `username`, `password`, `homeDomain`, `homeFile`, `homePrefix`, `testSuiteParentFolder`, `testSuitePath`, `testSuiteName`, `testCaseName`, `testCaseExecutionLink`, `currentUrl`, `browser`, `device`, `provider`, `os`, `osVersion`, `abi`, `appFileName`.

Date/time: `todayYear`, `todayMonth`, `todayDayOfMonth`, `todayDayOfWeek`, `nextYear`, `previousYear`, `nextMonth`, `previousMonth`, `nowHour`, `nowMinute`, `nowSecond`, `nowDateIso`, `nowTimeIso`, `nowDateTimeIso`, `nowMillisecondsFrom1970`, `nowNanosecond`.

Reference any of them as `stored value "homeDomain"`. The `${homeDomain}` form interpolates **only** inside a `string with parameters "..."` literal (and inside `save expression`) — a bare `"quoted string"` is matched literally, so `check that page contains "Hi ${name}"` looks for the characters `${name}`. To interpolate, wrap the string: `check that page contains string with parameters "Hi ${name}"`, or compare against the saved value directly with `check that page contains stored value from "name"`.
