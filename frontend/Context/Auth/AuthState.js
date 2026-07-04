import React, { useReducer, useEffect } from "react";
import axios from "axios";

import AuthContext from "./authContext";
import authReducer from "./authReducer";

import { AUTH_LOADING, SET_AUTH, AUTH_ERROR } from "../types";

// Session-cookie auth against the same-origin backend (Qresp 2.0, identity
// only). All calls use relative /api paths, so the browser attaches the
// Flask session cookie itself; nothing is stored in localStorage. dev-login
// is a development/staging facility (backend keeps it off unless
// QRESP_ENABLE_DEV_LOGIN is set) and will be replaced by Google sign-in.
const AuthState = (props) => {
  const initialState = {
    loading: true,
    authenticated: false,
    user: null,
    error: null,
  };

  const [state, dispatch] = useReducer(authReducer, initialState);

  const refresh = async () => {
    dispatch({ type: AUTH_LOADING });
    try {
      const res = await axios.get("/api/auth/me");
      dispatch({ type: SET_AUTH, payload: res.data });
    } catch (err) {
      console.error(err);
      dispatch({
        type: SET_AUTH,
        payload: { authenticated: false, user: null },
      });
    }
  };

  const devLogin = async (email, name, isAdmin) => {
    try {
      const res = await axios.post("/api/auth/dev-login", {
        email: email,
        name: name || undefined,
        is_admin: Boolean(isAdmin),
      });
      dispatch({ type: SET_AUTH, payload: res.data });
      return { ok: true };
    } catch (err) {
      const status = err.response && err.response.status;
      const message =
        status === 404
          ? "Development login is unavailable on this server."
          : "Login failed, please check the email and try again.";
      dispatch({ type: AUTH_ERROR, payload: message });
      return { ok: false, error: message };
    }
  };

  const logout = async () => {
    try {
      await axios.post("/api/auth/logout");
    } catch (err) {
      console.error(err);
    }
    dispatch({
      type: SET_AUTH,
      payload: { authenticated: false, user: null },
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading: state.loading,
        authenticated: state.authenticated,
        user: state.user,
        error: state.error,
        refresh,
        devLogin,
        logout,
      }}
    >
      {props.children}
    </AuthContext.Provider>
  );
};

export default AuthState;
