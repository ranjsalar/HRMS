import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("AppController (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("/health (GET) returns ok", () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/health")
      .expect(200)
      .expect(({ body }: { body: { status: string } }) => {
        expect(body.status).toBe("ok");
      });
  });
});
