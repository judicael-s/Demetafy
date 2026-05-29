import type { JSX } from "solid-js";
import { Route, Router } from "@solidjs/router";
import { AppProvider } from "./state/app";
import { Shell } from "./components/Shell";
import Home from "./routes/Home";
import Feed from "./routes/Feed";
import Saved from "./routes/Saved";
import Dms from "./routes/Dms";
import Thread from "./routes/Thread";
import Stories from "./routes/Stories";
import Reposts from "./routes/Reposts";
import Posts from "./routes/Posts";
import Albums from "./routes/Albums";
import Profile from "./routes/Profile";
import Connections from "./routes/Connections";
import Settings from "./routes/Settings";
import Search from "./routes/Search";
import { RequireService } from "./components/RequireService";

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <Router root={Shell}>
        <Route path="/" component={Home} />
        <Route path="/feed" component={Feed} />
        <Route path="/profile" component={Profile} />
        <Route path="/saved" component={() => <RequireService service="instagram"><Saved /></RequireService>} />
        <Route path="/saved/c/:slug" component={() => <RequireService service="instagram"><Saved /></RequireService>} />
        <Route path="/dms" component={Dms} />
        <Route path="/dms/:slug" component={Thread} />
        <Route path="/stories" component={() => <RequireService service="instagram"><Stories /></RequireService>} />
        <Route path="/reposts" component={() => <RequireService service="instagram"><Reposts /></RequireService>} />
        <Route path="/posts" component={Posts} />
        <Route path="/albums" component={() => <RequireService service="facebook"><Albums /></RequireService>} />
        <Route path="/connections" component={Connections} />
        <Route path="/search" component={Search} />
        <Route path="/settings" component={Settings} />
        <Route path="*" component={Home} />
      </Router>
    </AppProvider>
  );
}
