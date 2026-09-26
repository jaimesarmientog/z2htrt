# Test Data needed

This refinement pass parameterized the following values. Before running these test cases, add each of these to the suite's **Test Data** section in the testRigor UI:

- `apiBaseUrl` → `https://restful-booker.herokuapp.com`
- `standardBookingPayload`:
  ```json
  {
    "firstname": "Jim",
    "lastname": "Brown",
    "totalprice": 111,
    "depositpaid": true,
    "bookingdates": {
      "checkin": "2024-01-01",
      "checkout": "2024-01-05"
    },
    "additionalneeds": "Breakfast"
  }
  ```
- `lastname` → `Doe`
- `email` → `john.doe@example.com`
- `phone` → `07123456789`
- `firstname` → `John`
- `username` → `admin`
- `password` → `password123` — **⚠️ set up as a HIDDEN value in testRigor**
- `username2` → `invalid_user`
- `password2` → `invalid_pass` — **⚠️ set up as a HIDDEN value in testRigor**
- `password3` → `wrongpassword` — **⚠️ set up as a HIDDEN value in testRigor**
- `firstname2` → `James`
- `lastname2` → `Smith`
- `additionalneeds` → `Lunch`
