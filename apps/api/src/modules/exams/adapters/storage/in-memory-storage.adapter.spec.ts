import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { runStoragePortContract } from "../../domain/ports/storage.port.contract";

runStoragePortContract("InMemoryStorageAdapter", () => new InMemoryStorageAdapter());
