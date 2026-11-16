import "./env";
import { afterAll } from "vitest";
import { closePool } from "@/server/db";

afterAll(() => closePool());
