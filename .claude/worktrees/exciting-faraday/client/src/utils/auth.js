export const auth = {
    login(username) {
      localStorage.setItem("loggedInUser", username);
    },
    logout() {
      localStorage.removeItem("loggedInUser");
    },
    isAuthenticated() {
      return !!localStorage.getItem("loggedInUser");
    },
    getUser() {
      return localStorage.getItem("loggedInUser");
    },
  };
  