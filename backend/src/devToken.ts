import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
const token = jwt.sign(
  {
    id: "22222222-2222-2222-2222-222222222222",
    email: "b@test.com"
  },
  process.env.JWT_SECRET!,
  { expiresIn: "7d" }
);

console.log(token);