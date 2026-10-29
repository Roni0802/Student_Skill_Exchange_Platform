# Student Skill Exchange Platform

A six-module student skill exchange website using HTML/CSS, JavaScript/jQuery, AngularJS, Node.js/Express, JSON and MongoDB/Mongoose.

## Run on Windows
1. Extract this ZIP and open the `Student_Skill_Exchange_Six_Modules` folder in VS Code.
2. Open a terminal in that folder.
3. Run `npm install` and then `npm start`.
4. Open `http://localhost:3000`.

## How data works
- There are **no preloaded sample students, skills, or exchange requests**.
- Create an account or log in before accessing the portal.
- Skills appear in the marketplace only after a registered student submits the **Offer a skill** form.
- Exchange requests are created by students through the **Request exchange** button.
- The default MongoDB database is `student_skill_exchange_clean`, so older demo records in the previous `student_skill_exchange` database are not shown. Existing old data is not deleted.
- If MongoDB is unavailable, the app uses temporary in-memory storage; data will reset when the server restarts.

## Requirements
- Node.js (LTS recommended)
- Optional: MongoDB Community Server running locally on port 27017

## Main features
- Student registration and login
- Student profile editing
- Search and filter manually submitted skill listings
- Offer a skill and request exchanges
- MongoDB integration with temporary in-memory fallback
- Notification badge counts unread notifications and decreases when each notification is opened
- Learning-session notifications go only to the invited partner, not the organizer
- Message notifications go only to the recipient
- Chat conversations show your messages on the right in blue and received messages on the left in light grey, with sender labels and the input fixed at the bottom

This is an educational project and is not production-ready authentication software.
