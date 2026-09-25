# Test Data needed

This refinement pass parameterized the following values. Before running these test cases, add each of these to the suite's **Test Data** section in the testRigor UI:

- `apiBaseUrl` → `https://restful-booker.herokuapp.com`
- `adminAuthCredentials`:
  ```json
  {
    "username": "admin",
    "password": "<sensitive — set manually in Test Data, value not shown here>"
  }
  ```
- `validBookingPayload`:
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
- `firstname` → `Jane`
- `lastname` → `Doe`
- `email` → `jane.doe@example.com`
- `phone` → `12345678901`
- `username` → `invalid_user`
- `password` → `<sensitive — set manually in Test Data, value not shown here>`
- `firstname2` → `James`
- `lastname2` → `Brown`
- `checkin` → `2024-02-01`
- `additionalneeds` → `Lunch`
