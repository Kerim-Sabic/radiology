// Just the parts of fengari (a Lua 5.3 VM in JavaScript) that tests/fakeRedis.ts uses to run the server's Lua scripts.
declare module 'fengari' {
  type State = object;
  type LuaString = Uint8Array;
  const fengari: {
    to_luastring(s: string): LuaString;
    lua: {
      LUA_OK: number;
      LUA_TNIL: number;
      LUA_TBOOLEAN: number;
      LUA_TNUMBER: number;
      LUA_TSTRING: number;
      LUA_TTABLE: number;
      lua_gettop(L: State): number;
      lua_settop(L: State, n: number): void;
      lua_type(L: State, i: number): number;
      lua_tojsstring(L: State, i: number): string;
      lua_tonumber(L: State, i: number): number;
      lua_toboolean(L: State, i: number): boolean;
      lua_isinteger(L: State, i: number): boolean;
      lua_tointeger(L: State, i: number): number;
      lua_pushstring(L: State, s: LuaString): void;
      lua_pushinteger(L: State, n: number): void;
      lua_pushboolean(L: State, b: boolean): void;
      lua_pushjsfunction(L: State, f: (L: State) => number): void;
      lua_newtable(L: State): void;
      lua_seti(L: State, i: number, n: number): void;
      lua_geti(L: State, i: number, n: number): number;
      lua_rawlen(L: State, i: number): number;
      lua_setfield(L: State, i: number, k: LuaString): void;
      lua_setglobal(L: State, k: LuaString): void;
      lua_pcall(L: State, nargs: number, nresults: number, msgh: number): number;
      lua_pop(L: State, n: number): void;
    };
    lauxlib: {
      luaL_newstate(): State;
      luaL_loadstring(L: State, s: LuaString): number;
      luaL_error(L: State, msg: LuaString): never;
    };
    lualib: { luaL_openlibs(L: State): void };
  };
  export default fengari;
}
