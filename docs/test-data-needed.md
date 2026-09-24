# Test Data needed

This refinement pass parameterized the following values. Before running these test cases, add each of these to the suite's **Test Data** section in the testRigor UI:

- `appBaseUrl` → `https://automationintesting.online`
- `apiBaseUrl` → `https://restful-booker.herokuapp.com`
- `adminAuthCredentials`:
  ```json
  {
    "username": "admin",
    "password": "password123"
  }
  ```
- `jimBrownBreakfastBookingPayload`:
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
- `jamesAllenDinnerBookingPayload`:
  ```json
  {
    "firstname": "James",
    "lastname": "Allen",
    "totalprice": 222,
    "depositpaid": false,
    "bookingdates": {
      "checkin": "2024-02-01",
      "checkout": "2024-02-10"
    },
    "additionalneeds": "Dinner"
  }
  ```
- `jimBrownBreakfastLegacyDatesBookingPayload`:
  ```json
  {
    "firstname": "Jim",
    "lastname": "Brown",
    "totalprice": 111,
    "depositpaid": true,
    "bookingdates": {
      "checkin": "2018-01-01",
      "checkout": "2019-01-01"
    },
    "additionalneeds": "Breakfast"
  }
  ```
- `lastname` → `Doe`
- `email` → `jane.doe@example.com`
- `phone` → `07123456789`
- `firstname` → `Jane`
- `username` → `invalid_user`
- `password` → `invalid_pass`
- `additionalneeds` → `Breakfast`
- `firstname2` → `Mary`
