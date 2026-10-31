// Lines the Rap app learns from before it has your songs: written for this app (original, no real
// song lyrics), in the everyday words of rap verses, so "next word" and "complete the line" have a
// feel for how lines run. Your own saved songs are added to these as you write.

export const LINES = `
I been on my grind since the early days
started with a dream and a couple of plays
they ain't believe in me but I kept it real
now they wanna know just how it feel
woke up in the morning with the sun in my eyes
told myself today I'm gonna win the prize
every single step I take is part of the plan
when they count me out I'm still the last one to stand
money on my mind but I keep my heart clean
living out the vision that I saw in a dream
I don't need the hype I just need the beat
put me on the stage and watch me turn up the heat
came up from the bottom now we working on the top
told them from the start that we never gonna stop
late nights in the studio working on the sound
every time I drop it shake the whole town
they say I'm too young but I'm built for this
every word I write it hit and never miss
hustle every day like there ain't no tomorrow
turn the pain to power and I put away the sorrow
keep my circle tight and my vision clear
all the doubt I had I left it back there
I remember nights when the fridge was empty
now my mama smiling and she telling me she proud of me
on the block where we grew up the lights was dim
every one of us was hoping for a chance to win
I just want the best for the people that I love
pray to keep me humble and I'm looking up above
writing in my notebook till the sun come up
pour my heart in every line and I never give up
they talk behind my back but they never say it to my face
I just keep it moving and I'm running my own race
riding through the city with the windows down
music playing loud so they hear us all around
I'm a different breed I don't follow the crowd
I'mma make my family and my city proud
everything I got I had to work for it
nobody gave me nothing I just went and got it
I can feel the rhythm moving in my soul
got the beat in my chest and it's out of control
never been the type to sit around and wait
if the door ain't open then I'm kicking down the gate
I was in the back now I'm in the front row
watch me take it higher than they ever gonna go
light it up tonight we gonna party till the dawn
dancing in the street until the music is gone
in a world so cold I keep a fire inside
got my head up high and I walk with pride
every little setback was a lesson in disguise
now I see the world through a pair of brand new eyes
keep it a hundred never fake it for the fame
when it's said and done they gonna remember the name
started from the ground with a vision and a pen
if I had to do it all I'd do it all again
running through the rain and I'm feeling the pressure
but I know the pain is gonna make me better
take a look around and tell me what you see
people chasing dreams just to try to be free
they don't understand what it took to get here
long nights cold days and a whole lot of fear
I'm on another level and I'm moving like a boss
every move I make is a win not a loss
with the crew we roll and we never fall apart
got the same blood and we share the same heart
when the beat drop everybody in the room
start to move like a flower in bloom
stack it up and save it never blow it on the dumb things
we just stacking paper while they chasing all the fun things
I'm too focused on the mission to be worried about the gossip
got a list of all my goals and I'm checking every topic
lost a lot of friends along the way
but the real ones always gonna stay
I can see the finish line and it's close
keep on pushing harder when it matters the most
look me in the eye and tell me that you down
we can take it all and we can run the town
they was sleeping on me now they waking up
cheers to the come up let me raise my cup
it's a cold world but I keep my head warm
I was born to ride through the middle of the storm
from the corner to the top floor
everybody want a piece but they never knew the score
make a little noise and they wanna hear more
gotta keep it moving cause I'm living for the tour
my words cut deep like a blade in the dark
every single verse leave a permanent mark
never let the money ever change who I am
I'm the same kid running with a plan
you can hate on me but it don't change a thing
I'mma keep on shining like a brand new ring
we was broke but we always had each other
looking out for one another like a brother
take the bad with the good and I keep it moving
every day I wake up and I'm still improving
on the mic I'm a monster I'm a different kind
every bar I spit gonna blow your mind
when the lights come on and the crowd go wild
I'm a grown man now but I still feel like a child
I don't play the game I just make my own rules
got the knowledge from the streets and they ain't teach it in the schools
all my life I been dreaming about this moment
now it's here and I'mma take it and I own it
got a heart of gold and a mind of steel
every word I say is a word I feel
let the music play and the bass hit hard
feel it in your chest from the front to the yard
I been through the fire and I came out cold
got a story to tell that ain't never been told
nobody ever said that it would be easy
but I keep going even when it's freezing
I'mma rise up every single time I fall
standing tall I'm ready to give it my all
`.trim().split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Line endings with a slot for a rhyming word, by the slot's part of speech: "complete the line" fills
 * them with words that rhyme with the line you're answering.
 */
export const ENDINGS = {
  n: ['in the {}', 'like a {}', 'on my {}', 'with the {}', 'for the {}', 'to the {}', 'out the {}', 'all about the {}', 'never lose the {}', 'chasing the {}', "that's my {}", "I'm the {}"],
  v: ['watch me {}', 'I was born to {}', 'never gonna {}', "they can't {}", 'let it {}', "I'mma {}", 'we gonna {}', 'still gotta {}', 'tell me how to {}'],
  a: ["I'm feeling {}", 'keep it {}', 'stay {}', 'so {}', "it's getting {}", 'we living {}', 'forever {}'],
};
