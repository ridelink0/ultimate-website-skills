/* A stand-in for a real animation library: it defines the global the cost
   checker looks for, without a network fetch, so the fixture is deterministic
   offline. getChildren() reporting nothing running is what "loaded, never
   called" looks like from the outside. */
window.gsap = { globalTimeline: { getChildren: () => [] } };
