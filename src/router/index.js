import { createRouter, createWebHistory } from 'vue-router'
import { useConfigStore } from '../stores/config'

import Login     from '../views/Login.vue'
import Home      from '../views/Home.vue'
import Artists   from '../views/Artists.vue'
import Albums    from '../views/Albums.vue'
import Playlists from '../views/Playlists.vue'
import Search    from '../views/Search.vue'

const routes = [
  { path: '/login',         component: Login,     name: 'login'           },
  { path: '/home',          component: Home,      name: 'home'            },
  { path: '/artists',       component: Artists,   name: 'artists'         },
  { path: '/artists/:id',   component: Artists,   name: 'artist-detail'   },
  { path: '/albums',        component: Albums,    name: 'albums'          },
  { path: '/albums/:id',    component: Albums,    name: 'album-detail'    },
  { path: '/playlists',     component: Playlists, name: 'playlists'       },
  { path: '/playlists/:id', component: Playlists, name: 'playlist-detail' },
  { path: '/search',        component: Search,    name: 'search'          },
  { path: '/',              redirect: '/home'                              },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const config = useConfigStore()
  if (!config.loggedIn && to.name !== 'login') {
    return { name: 'login' }
  }
})

export default router