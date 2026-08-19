import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function buildHost(response: unknown, request: unknown = { url: "/some/path", id: "req-1" }): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

function fakeResponse(headersSent = false) {
  return {
    headersSent,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn(),
    destroy: jest.fn(),
  };
}

function fakeLogger() {
  return { error: jest.fn(), warn: jest.fn() } as unknown as jest.Mocked<Logger>;
}

describe("AllExceptionsFilter", () => {
  describe("when the response has not started yet (existing behaviour)", () => {
    it("mirrors Nest's own body for an HttpException, without logging a 4xx as a server error", () => {
      const logger = fakeLogger();
      const res = fakeResponse();
      const exception = new BadRequestException("nope");

      new AllExceptionsFilter(logger).catch(exception, buildHost(res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(exception.getResponse());
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("logs and mirrors the body for a 5xx HttpException", () => {
      const logger = fakeLogger();
      const res = fakeResponse();
      const exception = new InternalServerErrorException("boom");

      new AllExceptionsFilter(logger).catch(exception, buildHost(res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("returns Nest's generic 500 body for a non-HttpException, never the raw message", () => {
      const logger = fakeLogger();
      const res = fakeResponse();

      new AllExceptionsFilter(logger).catch(new Error("secret internals"), buildHost(res));

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.json).toHaveBeenCalledWith({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: "Internal server error",
      });
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Regression (P0): a hand-rolled SSE route that flushes headers and then
   * throws used to reach `res.status().json()` here, which Express rejects
   * with "Cannot set headers after they are sent" — thrown from inside the
   * filter, i.e. unhandled, i.e. the whole process died. One dropped
   * connection is the only acceptable cost.
   */
  describe("when the response has already started", () => {
    it("does not try to write an HttpException body, and drops the connection instead", () => {
      const logger = fakeLogger();
      const res = fakeResponse(true);

      new AllExceptionsFilter(logger).catch(new NotFoundException("gone"), buildHost(res));

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.destroy).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it("does not try to write a 500 body for a non-HttpException either", () => {
      const logger = fakeLogger();
      const res = fakeResponse(true);

      new AllExceptionsFilter(logger).catch(new Error("boom"), buildHost(res));

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.destroy).toHaveBeenCalledTimes(1);
    });

    it("never throws, whatever the response object does", () => {
      const logger = fakeLogger();
      const res = {
        headersSent: true,
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        destroy: jest.fn(() => {
          throw new Error("socket already gone");
        }),
      };

      expect(() => new AllExceptionsFilter(logger).catch(new Error("boom"), buildHost(res))).not.toThrow();
    });
  });
});
