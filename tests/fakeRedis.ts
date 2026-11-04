/**
 * An in-memory Redis for server tests that runs the server's own Lua scripts (with fengari, a Lua VM in JavaScript)
 * against strings, hashes and lists, and answers like the Upstash client: values that are JSON come back parsed.
 * Only the commands the server code uses are here.
 */
import fengari from 'fengari';

const { lua, lauxlib, lualib, to_luastring } = fengari;
type Reply = string | number | null | Reply[];

/** Upstash's automatic deserialization: a JSON string comes back as its value. */
function parse(v: Reply): unknown {
  if (Array.isArray(v)) return v.map(parse);
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
const store = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

export class FakeRedis {
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  lists = new Map<string, string[]>();

  clear() {
    this.strings.clear();
    this.hashes.clear();
    this.lists.clear();
  }

  /** One Redis command, as Lua's redis.call would run it. */
  call(cmd: string, a: string[]): Reply {
    switch (cmd.toUpperCase()) {
      case 'GET':
        return this.strings.get(a[0]) ?? null;
      case 'SET':
        this.strings.set(a[0], a[1]);
        return 'OK';
      case 'DEL':
        return a.filter((k) => [this.strings, this.hashes, this.lists].map((m) => m.delete(k)).some(Boolean)).length;
      case 'HGET':
        return this.hashes.get(a[0])?.get(a[1]) ?? null;
      case 'HSET': {
        const h = this.hashes.get(a[0]) ?? new Map<string, string>();
        this.hashes.set(a[0], h);
        const isNew = !h.has(a[1]);
        h.set(a[1], a[2]);
        return isNew ? 1 : 0;
      }
      case 'HLEN':
        return this.hashes.get(a[0])?.size ?? 0;
      case 'RPUSH': {
        const l = this.lists.get(a[0]) ?? [];
        this.lists.set(a[0], l);
        l.push(...a.slice(1));
        return l.length;
      }
      case 'LLEN':
        return this.lists.get(a[0])?.length ?? 0;
      case 'LRANGE': {
        const l = this.lists.get(a[0]) ?? [];
        const at = (i: number) => (i < 0 ? l.length + i : i);
        return l.slice(Math.max(0, at(Number(a[1]))), at(Number(a[2])) + 1);
      }
      default:
        throw new Error(`FakeRedis: ${cmd} is not implemented`);
    }
  }

  /** EVAL: runs the script with KEYS, ARGV and redis.call, converting replies the way Redis does. */
  eval(script: string, keys: string[], args: string[]): Reply {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    const push = (v: Reply) => {
      if (v === null) lua.lua_pushboolean(L, false);
      else if (typeof v === 'number') lua.lua_pushinteger(L, v);
      else if (typeof v === 'string') lua.lua_pushstring(L, to_luastring(v));
      else {
        lua.lua_newtable(L);
        v.forEach((x, i) => {
          push(x);
          lua.lua_seti(L, -2, i + 1);
        });
      }
    };
    const read = (i: number): Reply => {
      const t = lua.lua_type(L, i);
      if (t === lua.LUA_TNUMBER) return Math.trunc(lua.lua_tonumber(L, i));
      if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(L, i);
      if (t === lua.LUA_TTABLE) {
        const out: Reply[] = [];
        for (let k = 1; k <= lua.lua_rawlen(L, i); k++) {
          lua.lua_geti(L, i, k);
          out.push(read(-1));
          lua.lua_pop(L, 1);
        }
        return out;
      }
      return null;
    };
    const table = (name: string, values: string[]) => {
      lua.lua_newtable(L);
      values.forEach((v, i) => {
        lua.lua_pushstring(L, to_luastring(v));
        lua.lua_seti(L, -2, i + 1);
      });
      lua.lua_setglobal(L, to_luastring(name));
    };
    table('KEYS', keys);
    table('ARGV', args);
    lua.lua_newtable(L);
    lua.lua_pushjsfunction(L, (S) => {
      const n = lua.lua_gettop(S);
      const parts: string[] = [];
      for (let i = 1; i <= n; i++) parts.push(lua.lua_type(S, i) === lua.LUA_TNUMBER ? String(lua.lua_tonumber(S, i)) : lua.lua_tojsstring(S, i));
      push(this.call(parts[0], parts.slice(1)));
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring('call'));
    lua.lua_setglobal(L, to_luastring('redis'));
    if (lauxlib.luaL_loadstring(L, to_luastring(script)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(`Lua: ${lua.lua_tojsstring(L, -1)}`);
    return read(-1);
  }

  /** The part of the Upstash client the server code uses. */
  client() {
    const r = this;
    const commands = {
      get: async (k: string) => parse(r.call('GET', [k])),
      set: async (k: string, v: unknown) => r.call('SET', [k, store(v)]),
      del: async (...ks: string[]) => r.call('DEL', ks),
      llen: async (k: string) => r.call('LLEN', [k]),
      lrange: async (k: string, a: number, b: number) => parse(r.call('LRANGE', [k, String(a), String(b)])),
      eval: async (script: string, keys: string[], args: unknown[]) => parse(r.eval(script, keys, args.map(String))),
    };
    return {
      ...commands,
      multi() {
        const queued: Array<() => Promise<unknown>> = [];
        const tx = {
          get: (k: string) => (queued.push(() => commands.get(k)), tx),
          set: (k: string, v: unknown) => (queued.push(() => commands.set(k, v)), tx),
          del: (...ks: string[]) => (queued.push(() => commands.del(...ks)), tx),
          llen: (k: string) => (queued.push(() => commands.llen(k)), tx),
          lrange: (k: string, a: number, b: number) => (queued.push(() => commands.lrange(k, a, b)), tx),
          exec: async () => {
            const out: unknown[] = [];
            for (const q of queued) out.push(await q());
            return out;
          },
        };
        return tx;
      },
    };
  }
}
