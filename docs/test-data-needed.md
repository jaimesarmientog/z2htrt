# Test Data needed

This refinement pass parameterized the following values. Before running these test cases, add each of these to the suite's **Test Data** section in the testRigor UI:

- `apiBaseUrl` → `https://restful-booker.herokuapp.com`
- `validBookingPayloadJanuaryFive`:
  ```json
  {
    "firstname": "Jim",
    "lastname": "Brown",
    "totalprice": 111,
    "depositpaid": true,
    "bookingdates": {
      "checkin": "2025-01-01",
      "checkout": "2025-01-05"
    },
    "additionalneeds": "Breakfast"
  }
  ```
- `validBookingPayloadJanuaryOneNight`:
  ```json
  {
    "firstname": "Jim",
    "lastname": "Brown",
    "totalprice": 111,
    "depositpaid": true,
    "bookingdates": {
      "checkin": "2024-01-01",
      "checkout": "2024-01-02"
    },
    "additionalneeds": "Breakfast"
  }
  ```
- `validBookingPayloadJamesLunch`:
  ```json
  {
    "firstname": "James",
    "lastname": "Brown",
    "totalprice": 222,
    "depositpaid": false,
    "bookingdates": {
      "checkin": "2024-02-01",
      "checkout": "2024-02-05"
    },
    "additionalneeds": "Lunch"
  }
  ```
- `firstname` → `John`
- `lastname` → `Doe`
- `email` → `john.doe@example.com`
- `phone` → `07123456789`
- `username` → `admin`
- `password` → `password123` — **⚠️ set up as a HIDDEN value in testRigor**
- `username2` → `invalid_user`
- `password2` → `invalid_pass` — **⚠️ set up as a HIDDEN value in testRigor**
- `firstname2` → `Jane`
- `checkin` → `2025-02-01`
- `checkout` → `2025-02-10`
- `checkin2` → `2025-03-01`
- `lastname2` → `Smith`
