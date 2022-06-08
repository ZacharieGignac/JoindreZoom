/*
VERSION 1.0
JoindreZoom_SA
Basé sur "JoindreZoom" (https://github.com/ulaval/telepresence-e21) version 4.1
Zacharie Gignac 2021
Licence MIT
*/

import xapi from 'xapi';

const OPT_FORCE_OUT_OF_BAND_DTMF = 200001; //Force les touches numérique à être transmises en dehors du canal audio
const OPT_SUPPRESS_AUDIO_PROMPTS = 200006; //Enlève les messages audio d'accueil de Zoom
const OPT_ENABLE_1080P = 309;              //Active le support 1080p (Full HD)
const OPT_SUPPRESS_VISUAL_MENU = 504;      //Désactive le menu à l'écran (une option s'ajoute dans les contrôles zoom pour l'activer)


const advancedOptions = [
  OPT_FORCE_OUT_OF_BAND_DTMF,
  OPT_ENABLE_1080P,
  OPT_SUPPRESS_AUDIO_PROMPTS,
  OPT_SUPPRESS_VISUAL_MENU
];



const DEBUG = false;

var zoomConfig = {
  call: {
    sipDomains: [`zmca.us`, `zoomcrc.com`], //Domaines SIP reconnus. Le premier est celui par défaut pour la composition.

  },
  callHistory: {
    autoDelete: true, //Nettoyage de l'historique d'appel: true, false
    autoDeleteMethod: METHOD_ONDISCONNECT, //Méthode de nettoyage: METHOD_ONDISCONNECT , METHOD_ONSTANDBY
    autoDeleteTimeout: 3000 //Temps de grâce avant le nettoyage (ms)
  },
  ui: {
    iconOrder: 1
  }
}




/*---------------------------------------------------------------------------------*/
var widgetActionEventListeners = [];
var listeningToPrompts = undefined;
var prompts = [];

function getUniqueId() {
  return (Date.now() + Math.floor(Math.random() * 100000));

}

var UI = {
  widgets: {
    addActionListener: function (listener) {
      widgetActionEventListeners.push(listener);
    }
  },
  prompt: {
    display: function (promptOptions, cancelcallback) {
      registerPromptsListeners();
      var i = 0;
      const uniqueId = getUniqueId()
      promptOptions.FeedbackId = uniqueId;
      promptOptions.cancelcallback = cancelcallback;
      if (promptOptions.Options != undefined) {
        promptOptions.Options.forEach(o => {
          promptOptions[`Option.${++i}`] = o.label;
          o.id = i;
        });
      }
      prompts.push(promptOptions);
      var dispargs = {};
      dispargs = Object.assign(dispargs, promptOptions);
      delete dispargs.Options;
      delete dispargs.cancelcallback;
      xapi.command('UserInterface Message Prompt Display', dispargs)
    }
  },
  textPrompt: {
    display: function (promptOptions, callback, cancelcallback) {
      registerPromptsListeners();
      var i = 0;
      const uniqueId = getUniqueId();
      promptOptions.FeedbackId = uniqueId;
      promptOptions.callback = callback;
      promptOptions.cancelcallback = cancelcallback;
      prompts.push(promptOptions);
      var dispargs = {};
      dispargs = Object.assign(dispargs, promptOptions);
      delete dispargs.Options;
      delete dispargs.callback;
      delete dispargs.cancelcallback;
      xapi.command('UserInterface Message TextInput Display', dispargs);
    }
  },
  alert: {
    display: function (title, text, callback) {
      registerPromptsListeners();
      UI.prompt.display({
        Duration: 0,
        FeedbackId: getUniqueId(),
        Title: title,
        Text: text,
        Options: [
          {
            label: `OK`,
            callback: function () { if (callback != undefined) { callback(); } }
          }
        ]
      }, cb => {
        if (callback != undefined)
          callback();
      }, ccb => {
        if (callback != undefined)
          callback();
      });
    }
  },
  perminfo: {
    display: function (title, text) {
      registerPromptsListeners();
      var promptOptions = {};
      const uniqueId = getUniqueId();
      promptOptions.FeedbackId = uniqueId;
      UI.prompt.display({
        Duration: 0,
        FeedbackId: uniqueId,
        Title: title,
        Text: text,
        Options: [

        ]
      }, cb => {
        UI.perminfo.display(title, text);
      }, ccb => {
        UI.perminfo.display(title, text);
      });
      return promptOptions;
    }
  },
  clearPrompt: function (prompt) {
    xapi.Command.UserInterface.Message.Prompt.Clear({
      FeedbackId: prompt.FeedbackId
    });
  },
  removePrompt: function (prompt) {
    for (var i = 0; i < prompts.length; i++) {
      if (prompts[i].FeedbackId === prompt.FeedbackId) {
        prompts.splice(i, 1);
      }
    }
  },
  Interlock: class {
    constructor(toggles) {
      this.toggles = toggles;

    }
  },
  Button: class {
    constructor(widgetId) {
      this.wid = widgetId;
    };
    onClick(listener) {
      UI.widgets.addActionListener(action => {
        if (action.Action != undefined) {
          if (action.Action.Type == 'clicked' && action.Action.WidgetId == this.wid) {
            listener(action.Action);
          }
        }
      });
    };
  },

  Toggle: class {
    constructor(widgetid, defaultValue) {
      this._listener = undefined;
      this._wid = widgetid;
      if (defaultValue != undefined) {
        this.state = defaultValue;
      }

    }
    onChange(listener) {

      this._listener = listener;
      UI.widgets.addActionListener(action => {
        if (action.Action != undefined) {
          if (action.Action.Type == 'changed' && action.Action.WidgetId == this._wid)
            listener(action.Action.Value);
        }
      });
    }
    set state(value) {
      this._value = value;
      xapi.Command.UserInterface.Extensions.Widget.SetValue({
        WidgetId: this._wid,
        Value: this._value
      });
    }
    get state() {
      return this._value;
    }
  },

  UpDown: class {
    constructor(widgetId, value) {
      this._wid = widgetId;
      this.value = value;
    }
    onChange(listener) {

      UI.widgets.addActionListener(action => {
        if (action.Action != undefined) {
          if (action.Action.WidgetId == this._wid && action.Action.Type == 'clicked') {
            listener(action.Action.Value);
          }
        }

      });

    }
    set value(value) {
      this._value = value;
      xapi.Command.UserInterface.Extensions.Widget.SetValue({
        WidgetId: this._wid,
        Value: this._value
      }).catch(err => {
        if (DEBUG)
          console.log(err);
      });

    }
    get value() {
      return this._value;
    }
  }
};

const CONFTYPE_HOST = 'HOST';
const CONFTYPE_GUEST = 'GUEST';

const METHOD_ONDISCONNECT = `AUTODELETEMETHOD_ONDISCONNECT`;
const METHOD_ONSTANDBY = `AUTODELETEMETHOD_ONSTANDBY`;

var currentCall = {};
var deleteCallHistoryTimeout;
var hostkeyShown = false;
var obtpPattern = /\d*\.\d*@/;
var zoomCallConfig = {
  obtp: true
};


function getOptions() {
  return advancedOptions.join('');
}

function callZoom() {
  var sipuri = '';
  if (zoomCallConfig.conferenceType == CONFTYPE_HOST) {
    sipuri = `${zoomCallConfig.conferenceNumber}.${zoomCallConfig.conferencePin}.${getOptions()}.${zoomCallConfig.hostKey}@${zoomConfig.call.sipDomains[0]}`;
  }
  else if (zoomCallConfig.conferenceType == CONFTYPE_GUEST) {
    sipuri = zoomCallConfig.conferenceNumber + '.' + zoomCallConfig.conferencePin + `.${getOptions()}@${zoomConfig.call.sipDomains[0]}`;
  }


  xapi.Command.Dial({
    Number: `${sipuri}`,
    DisplayName: `Conférence Zoom`
  });
}

function askPin() {
  zoomAskConferencePin(pin => {
      zoomCallConfig.conferencePin = pin;
      if (zoomCallConfig.conferenceType == CONFTYPE_HOST) {
        askHostKey();
      }
      else {
        callZoom();
      }
  }, (cancel) => { });
}
function askConfNumber() {
  zoomAskConferenceNumber(confnumber => {
    if (!isNaN(confnumber) && confnumber != '') {
      zoomCallConfig.conferenceNumber = confnumber;
      askPin();
    }
    else {
      UI.alert.display('Oups...', 'Le numéro de conférence doit être numérique...', () => {
        askConfNumber();
      });
    }
  }, (cancel) => { });
}
function askHostKey() {
  zoomAskHostKey(hostkey => {
    if (!isNaN(hostkey)) {
      zoomCallConfig.hostKey = hostkey;
      zoomCallConfig.obtp = false;
      callZoom();
    }
    else {
      UI.alert.display('Oups...', `La clé de l'organisateur doit être numérique...`, () => {
        askHostKey();
      });
    }
  },
    cancel => { });
}

xapi.Event.UserInterface.Extensions.Panel.Clicked.on(panel => {
  if (panel.PanelId === 'joinzoom') {
    zoomAskConferenceType(conftype => {
      zoomCallConfig.conferenceType = conftype;
      askConfNumber();
    },
      (cancel) => { }
    );
  }
});



function zoomAskConferenceType(callback, cancelcallback) {
  UI.prompt.display({
    Duration: 0,
    FeedbackId: 'fbZoomConfType',
    Title: `Êtes-vous animateur ou un participant ?`,
    Text: ``,
    Options: [
      {
        label: `Je suis l'animateur`,
        callback: function () { callback(CONFTYPE_HOST); }
      },
      {
        label: 'Je suis un participant',
        callback: function () { callback(CONFTYPE_GUEST); }
      }
    ]
  },
    cancel => {
      cancelcallback();
    });
}

function zoomAskConferenceNumber(callback, cancelcallback) {
  UI.textPrompt.display({
    Duration: 0,
    FeedbackId: 'fbZoomConfNumber',
    InputType: 'Numeric',
    SubmitText: 'Suivant',
    KeyboardState: 'Open',
    Placeholder: 'ID de la réunion',
    Title: 'ID de la réunion',
    Text: 'Entrez le ID de la réunion'
  },
    response => {
      callback(response.Text);
    },
    cancel => {
      cancelcallback();
    });
}

function zoomAskConferencePin(callback, cancelcallback) {

  UI.textPrompt.display({
    Duration: 0,
    FeedbackId: 'fbZoomPINNumber',
    InputType: 'SingleLine',
    SubmitText: 'Suivant',
    KeyboardState: 'Open',
    Placeholder: `Code secret, ou vide`,
    Title: `Code secret`,
    Text: `Entrez le code secret de la rencontre. Laissez vide si cette rencontre n'a pas de code secret.`
  },
    response => {
      callback(response.Text);
    },
    cancel => {
      cancelcallback();
    })
}

function zoomAskHostKey(callback, cancelcallback) {
  UI.textPrompt.display({
    Duration: 0,
    FeedbackId: 'fbZoomHostKey',
    InputType: 'Numeric',
    SubmitText: 'Suivant',
    KeyboardState: 'Open',
    Placeholder: `Clé de l'animateur`,
    Title: `Clé de l'animateur`,
    Text: `Entrez la clé de l'animateur`
  },
    response => {
      callback(response.Text);
    },
    cancel => {
      cancelcallback();
    }
  );
}


var btnLayout = new UI.Button('zoomChangeLayout');
btnLayout.onClick(() => {
  dtmfSend('#11');
});




var btnRecord = new UI.Button('zoomRecord');
btnRecord.onClick(() => {
  dtmfSend('#15');
  UI.prompt.display({
    Duration: 8,
    Title: `Enregistrement`,
    Text: `L'état de l'enregistrement est affiché en haut à gauche sur le moniteur de téléprésence.`,
    Options: [
      {
        id: 'zoomrecok',
        label: 'OK',
        callback: function () { xapi.Command.UserInterface.Extensions.Panel.Close(); }
      }
    ]
  },
    cancel => {
      xapi.Command.UserInterface.Extensions.Panel.Close();
    });
});

var btnMuteAll = new UI.Button('zoomMuteAll');
btnMuteAll.onClick(() => {
  dtmfSend('#176');
  xapi.Command.UserInterface.Extensions.Panel.Close();
});

var btnAdmitAll = new UI.Button('zoomAdmitAll');
btnAdmitAll.onClick(() => {
  dtmfSend('#1610');
  xapi.Command.UserInterface.Extensions.Panel.Close();
});

var btnMenu = new UI.Button('zoomMenu');
btnMenu.onClick(() => {
  dtmfSend('7');
  xapi.Command.UserInterface.Extensions.Panel.Close();
});






function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deleteCallHistory() {
  if (zoomConfig.callHistory.autoDelete) {
    xapi.Command.CallHistory.Get().then(calls => {
      calls.Entry.forEach(e => {
        if (isZoom(e.CallbackNumber)) {
          xapi.Command.CallHistory.DeleteEntry({
            CallHistoryId: e.CallHistoryId
          });
        }
      });
    });
  }
}

function dtmfSend(string) {
  xapi.Command.Call.dtmfSend({
    DTMFString: `*${string}`
  });
}
function dtmfSendCode(string) {
  xapi.Command.Call.dtmfSend({
    DTMFString: `${string}`
  });
}

function isZoom(cbn) {
  var is = false;
  zoomConfig.call.sipDomains.forEach(sd => {
    let t = new RegExp(sd);
    if (t.test(cbn)) {
      is = true;
    }
  });
  return is;
}


xapi.Status.Call.on(call => {
  Object.assign(currentCall, call);
  if (currentCall.Status === 'Connected') {
    if (isZoom(currentCall.CallbackNumber)) {
      if (zoomCallConfig.obtp == true && obtpPattern.test(currentCall.CallbackNumber) && !hostkeyShown) {
        if (DEBUG)
          console.log(zoomConfig);
        hostkeyShown = true;
      }
      showZoomInCallMenu();
      clearTimeout(deleteCallHistoryTimeout);
    }
    else {
      hideZoomInCallMenu();
    }
  }
});


xapi.Event.CallDisconnect.on(call => {
  hideZoomInCallMenu();
  zoomCallConfig.obtp = true;
  hostkeyShown = false;
  if (zoomConfig.callHistory.autoDeleteMethod === METHOD_ONDISCONNECT) {
    deleteCallHistoryTimeout = setTimeout(deleteCallHistory, zoomConfig.callHistory.autoDeleteTimeout);
  }
});


xapi.Status.Standby.on(status => {
  if (status.State === `Standby` && zoomConfig.callHistory.autoDeleteMethod === METHOD_ONSTANDBY) {
    deleteCallHistoryTimeout = setTimeout(deleteCallHistory, zoomConfig.callHistory.autoDeleteTimeout);
  }
  else if (status.State == 'Off') {
    createUi(advancedOptions, zoomConfig.ui.iconOrder);
  }
});

function hideCallZoomButton() {
  xapi.Command.UserInterface.Extensions.Panel.Update({
    PanelId: 'joinzoom',
    Visibility: 'Hidden'
  });
}
function showCallZoomButton() {
  xapi.Command.UserInterface.Extensions.Panel.Update({
    PanelId: 'joinzoom',
    Visibility: 'Auto'
  });
}
function hideZoomInCallMenu() {
  xapi.Command.UserInterface.Extensions.Panel.Update({
    PanelId: 'panelZoom',
    Visibility: 'Hidden'
  });
}
function showZoomInCallMenu() {
  xapi.Command.UserInterface.Extensions.Panel.Update({
    PanelId: 'panelZoom',
    Visibility: 'Auto'
  });
}

function privatemode_enabled() {
  xapi.Command.UserInterface.Extensions.Panel.Update({
    PanelId: 'joinzoom',
    Visibility: 'Hidden'
  });
}
function privatemode_disabled() {
  xapi.Command.UserInterface.Extensions.Panel.Update({
    PanelId: 'joinzoom',
    Visibility: 'Auto'
  });
}
function usbmode_enabled() {
  hideCallZoomButton();
}
function usbmode_disabled() {
  showCallZoomButton();
}

function init() {
  hideZoomInCallMenu();
}
function registerPromptsListeners() {
  if (listeningToPrompts == undefined) {
    if (DEBUG)
      console.log('Registering Prompt Listeners.');
    listeningToPrompts = true;
    xapi.event.on('UserInterface Message Prompt Response', (response) => {
      prompts.forEach(p => {
        if (p.FeedbackId == response.FeedbackId) {
          if (p.callback != undefined) p.callback(response);
          prompts.splice(prompts.indexOf(p));
          if (p.Options != undefined) {
            p.Options.forEach(o => {
              if (o.id == response.OptionId) {
                o.callback();

              }
            });
          }
          UI.removePrompt(p);
        }
      });
    });

    xapi.event.on('UserInterface Message TextInput Response', (response) => {
      prompts.forEach(p => {
        if (p.FeedbackId == response.FeedbackId) {
          if (p.callback != undefined) p.callback(response);
          UI.removePrompt(p);
        }
      });
    });

    xapi.event.on('UserInterface Message TextInput Clear', (response) => {
      prompts.forEach(p => {
        if (p.FeedbackId == response.FeedbackId) {
          if (p.cancelcallback != undefined) p.cancelcallback();
          UI.removePrompt(p);
        }
      });
    });

    xapi.event.on('UserInterface Message Prompt Cleared', (response) => {
      prompts.forEach(p => {
        if (p.FeedbackId == response.FeedbackId) {
          UI.removePrompt(p);
          if (p.cancelcallback != undefined) p.cancelcallback();
        }
      });
    });

  }
  else {
    if (DEBUG)
      console.log('NOT Registering Prompt Listeners. Already registered.');
  }
}
xapi.Event.UserInterface.Extensions.Widget.on(event => {
  widgetActionEventListeners.forEach(l => {
    l(event);
  });
});

var advOptions;
function getControls() {
  var xml = '';
  if (advOptions.includes(504)) {
    xml += `
      <Row>
      <Name>Row</Name>
      <Widget>
          <WidgetId>widget_9</WidgetId>
          <Name>Activer/Désactiver le menu</Name>
          <Type>Text</Type>
          <Options>size=3;fontSize=normal;align=left</Options>
      </Widget>
      <Widget>
          <WidgetId>zoomMenu</WidgetId>
          <Type>Button</Type>
          <Options>size=1;icon=list</Options>
      </Widget>
      </Row>
    `;
  }

  return xml;
}
export function createUi(options, io) {
  advOptions = options;
  xapi.command('UserInterface Extensions Panel Save', {
    PanelId: 'joinzoom'

  },
    `
<Extensions>
  <Version>1.8</Version>
  <Panel>
    <Order>${io}</Order>
    <PanelId>joinzoom</PanelId>
    <Origin>local</Origin>
    <Type>Home</Type>
    <Icon>Custom</Icon>
    <Name>Joindre Zoom</Name>
    <ActivityType>Custom</ActivityType>
    <CustomIcon>
      <Content>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</Content>
      <Id>5400c95237c41cd1b0d4fce7a9b46d413d7ba5b86521aff2aac99edda845c74f</Id>
    </CustomIcon>
  </Panel>
</Extensions>
      `);


  xapi.command('UserInterface Extensions Panel Save', {
    PanelId: 'panelZoom'

  },
    `
<Extensions>
  <Version>1.8</Version>
  <Panel>
    <Order>4</Order>
    <PanelId>panelZoom</PanelId>
    <Origin>local</Origin>
    <Type>InCall</Type>
    <Icon>Custom</Icon>
    <Color>#07C1E4</Color>
    <Name>Contrôles Zoom</Name>
    <ActivityType>Custom</ActivityType>
    <CustomIcon>
      <Content>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</Content>
      <Id>5400c95237c41cd1b0d4fce7a9b46d413d7ba5b86521aff2aac99edda845c74f</Id>
    </CustomIcon>
    <Page>
      <Name>Contrôles Zoom</Name>
      <Row>
        <Name>Row</Name>
        <Widget>
          <WidgetId>widget_2</WidgetId>
          <Name>Tous les participants muets</Name>
          <Type>Text</Type>
          <Options>size=3;fontSize=normal;align=left</Options>
        </Widget>
        <Widget>
          <WidgetId>zoomMuteAll</WidgetId>
          <Type>Button</Type>
          <Options>size=1;icon=mic_muted</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Row</Name>
        <Widget>
          <WidgetId>widget_4</WidgetId>
          <Name>Admettre tous les invités en salle d'attente</Name>
          <Type>Text</Type>
          <Options>size=3;fontSize=normal;align=left</Options>
        </Widget>
        <Widget>
          <WidgetId>zoomAdmitAll</WidgetId>
          <Type>Button</Type>
          <Options>size=1;icon=plus</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Row</Name>
        <Widget>
          <WidgetId>widget_6</WidgetId>
          <Name>Changer la disposition des participants</Name>
          <Type>Text</Type>
          <Options>size=3;fontSize=normal;align=left</Options>
        </Widget>
        <Widget>
          <WidgetId>zoomChangeLayout</WidgetId>
          <Type>Button</Type>
          <Options>size=1;icon=stop</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Row</Name>
        <Widget>
          <WidgetId>widget_8</WidgetId>
          <Name>Démarrer / Arrêter l'enregistrement</Name>
          <Type>Text</Type>
          <Options>size=3;fontSize=normal;align=left</Options>
        </Widget>
        <Widget>
          <WidgetId>zoomRecord</WidgetId>
          <Type>Button</Type>
          <Options>size=1;icon=red</Options>
        </Widget>
      </Row>
      ${getControls()}
      <Options>hideRowNames=1</Options>
    </Page>
  </Panel>
</Extensions>
      `);
}

createUi(advancedOptions, zoomConfig.ui.iconOrder);
init();
